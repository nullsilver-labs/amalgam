import type { ModelConnection } from '../types';
import { readProviders, type ModelSpec, type Provider } from './config';

export const DISCOVERY_TIMEOUT_MS = 5000;
export const DISCOVERY_MAX_BYTES = 4 * 1024 * 1024;
export const DISCOVERY_MAX_MODELS = 2000;
export const DISCOVERY_CACHE_MS = 5 * 60_000;
export const DISCOVERY_RETRY_MS = 30_000;

class DiscoveryError extends Error {}
interface DiscoveryResult {
  models: ModelSpec[];
  state: 'discovered' | 'stale' | 'error';
  detail: string;
  checkedAt: string;
}
interface CacheEntry {
  signature: string;
  expires: number;
  result?: DiscoveryResult;
  pending?: Promise<DiscoveryResult>;
}

/** A bounded metadata read only. Never follow redirects or repeat without credentials. */
async function discover(provider: Provider, fetcher: typeof fetch, timeoutMs: number): Promise<ModelSpec[]> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new DiscoveryError('Model discovery timed out.'));
      controller.abort();
    }, timeoutMs);
  });
  const request = async () => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
    const response = await fetcher(`${provider.baseUrl}/models`, {
      method: 'GET', headers, redirect: 'manual', signal: controller.signal
    });
    reader = response.body?.getReader();
    controller.signal.throwIfAborted();
    if (response.status >= 300 && response.status < 400) throw new DiscoveryError('Model discovery refused a redirect. Configure the final API base URL.');
    if ([401, 403].includes(response.status)) throw new DiscoveryError('Model discovery credentials were rejected. Check the server API key and permissions.');
    if (!response.ok) throw new DiscoveryError(`Model discovery returned HTTP ${response.status}. The endpoint may not support GET /models.`);
    if (!reader) throw new DiscoveryError('Model discovery returned no response body.');
    if (Number(response.headers.get('content-length')) > DISCOVERY_MAX_BYTES) throw new DiscoveryError('Model discovery response exceeds the 4 MiB limit.');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '';
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > DISCOVERY_MAX_BYTES) throw new DiscoveryError('Model discovery response exceeds the 4 MiB limit.');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    let data: unknown;
    try { data = JSON.parse(text); }
    catch { throw new DiscoveryError('Model discovery returned malformed JSON.'); }
    if (!data || typeof data !== 'object' || !('data' in data) || !Array.isArray(data.data)) {
      throw new DiscoveryError('Model discovery expected an OpenAI-style data array.');
    }
    if (data.data.length > DISCOVERY_MAX_MODELS) throw new DiscoveryError('Model discovery exceeds the 2000-model limit. Use a manual list.');
    const models: ModelSpec[] = [];
    const ids = new Set<string>();
    for (const entry of data.data) {
      const id = entry?.id;
      // Match chat's qualified-ID limit; do not interpret an upstream ID's
      // numeric suffix as a context declaration or trust vendor metadata.
      if (typeof id !== 'string' || !id.trim() || id !== id.trim()
        || /[\u0000-\u001f\u007f]/.test(id) || `${provider.id}:${id}`.length > 300) {
        throw new DiscoveryError('Model discovery returned an invalid model ID.');
      }
      if (!ids.has(id)) { ids.add(id); models.push({ name: id, window: null }); }
    }
    return models;
  };
  // Also clean up a response that arrives after the deadline (for example,
  // from a fetch implementation that ignores abort while connecting).
  const pending = request().finally(() => { void reader?.cancel().catch(() => {}); });
  try { return await Promise.race([pending, deadline]); }
  finally {
    clearTimeout(timer!);
    controller.abort();
    // Cancellation must not extend the deadline if an upstream body stalls.
    void reader?.cancel().catch(() => {});
  }
}

/** One cache per app process, keyed only by trusted server configuration.
 * The factory isolates mocked tests; bootstrap and chat share the instance below.
 */
export function createModelCatalog({ fetcher = fetch, now = Date.now, timeoutMs = DISCOVERY_TIMEOUT_MS }: {
  fetcher?: typeof fetch; now?: () => number; timeoutMs?: number;
} = {}) {
  const cache = new Map<string, CacheEntry>();
  return async function modelCatalog(env: Record<string, string | undefined>): Promise<{
    providers: Provider[]; connections: ModelConnection[];
  }> {
    const configured = readProviders(env);
    for (const id of cache.keys()) if (!configured.some(p => p.id === id)) cache.delete(id);
    const entries = await Promise.all(configured.map(async provider => {
      const base = { id: provider.id, name: provider.name, destination: new URL(provider.baseUrl).host };
      const fallback = ` Set ${provider.id.toUpperCase()}_MODELS on the server for a manual override.`;
      if (provider.models.length || provider.kind === 'anthropic') {
        cache.delete(provider.id);
        const connection: ModelConnection = { ...base, state: provider.models.length ? 'explicit' : 'manual', checkedAt: null,
          detail: provider.models.length ? 'Explicit model list; discovery disabled. Generation has not been verified.'
            : `Anthropic discovery is not supported.${fallback}` };
        return { provider, connection };
      }
      const signature = JSON.stringify([provider.kind, provider.baseUrl, provider.apiKey]);
      let entry = cache.get(provider.id);
      if (!entry || entry.signature !== signature) {
        entry = { signature, expires: 0 };
        cache.set(provider.id, entry);
      }
      if (!entry.pending && (!entry.result || now() >= entry.expires)) {
        const target = entry;
        target.pending = (async (): Promise<DiscoveryResult> => {
          try {
            const models = await discover(provider, fetcher, timeoutMs);
            target.expires = now() + DISCOVERY_CACHE_MS;
            return { models, state: 'discovered', checkedAt: new Date(now()).toISOString(),
              detail: models.length ? `${models.length} model IDs discovered. Chat compatibility and access have not been verified.`
                : 'Model discovery returned an empty list.' };
          } catch (err) {
            target.expires = now() + DISCOVERY_RETRY_MS;
            const models = target.result?.models || [];
            return { models, state: models.length ? 'stale' : 'error', checkedAt: new Date(now()).toISOString(),
              detail: (err instanceof DiscoveryError ? err.message : 'Could not read the model list. Check the endpoint and network.')
                + (models.length ? ' Using the last successful list until discovery succeeds or the server restarts.' : '') };
          }
        })().then(result => { target.result = result; target.pending = undefined; return result; });
      }
      const result = entry.pending ? await entry.pending : entry.result!;
      return { provider: { ...provider, models: result.models }, connection: {
        ...base, state: result.state, checkedAt: result.checkedAt, detail: result.detail + fallback
      } satisfies ModelConnection };
    }));
    return { providers: entries.map(e => e.provider), connections: entries.map(e => e.connection) };
  };
}

export const modelCatalog = createModelCatalog();
