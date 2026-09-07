import type { ModelOption } from '../types';
export interface ModelSpec { name: string; window: number | null }
export type ProviderKind = 'openai' | 'anthropic';
export interface Provider {
  id: string; name: string; kind: ProviderKind; baseUrl: string; apiKey: string;
  models: ModelSpec[];
}

/*
 * Providers come from the environment, one variable prefix each. Three
 * slots are built in and keep their defaults: OPENAI_, ANTHROPIC_ and
 * COMPATIBLE_. PROVIDERS names any number more ("openrouter,ollama"), each
 * read from its own prefix, upper-cased. A slot reads <PREFIX>_MODELS,
 * _BASE_URL and _API_KEY, and optionally _KIND (openai or anthropic;
 * openai unless the slot is the Anthropic one) and _NAME (what the picker
 * shows). A slot with no models, no endpoint or, for the two hosted
 * built-ins, no key is simply absent.
 */
const BUILT_IN: Record<string, { name: string; kind: ProviderKind; baseUrl: string; keyRequired: boolean }> = {
  openai: { name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', keyRequired: true },
  anthropic: { name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', keyRequired: true },
  compatible: { name: 'Custom endpoint', kind: 'openai', baseUrl: '', keyRequired: false }
};

/**
 * A model entry is its ID, optionally followed by ":<tokens>" or ":<n>k" —
 * the context window the server should plan around. Only a trailing segment
 * that is nothing but digits (and an optional k) counts, and only from a
 * thousand up, so IDs with colons of their own, such as Ollama's
 * "llama3.1:8b", keep them.
 */
export function parseModel(entry: string): ModelSpec {
  const match = /^(.+):(\d+)(k?)$/i.exec(entry);
  if (!match) return { name: entry, window: null };
  const window = Number(match[2]) * (match[3] ? 1000 : 1);
  return window >= 1000 ? { name: match[1], window } : { name: entry, window: null };
}

/** The built-in slots, then every slot PROVIDERS names, in its order. */
export function providerIds(env: Record<string, string | undefined>): string[] {
  const ids = Object.keys(BUILT_IN);
  for (const raw of (env.PROVIDERS || '').split(',').map(s => s.trim()).filter(Boolean)) {
    const id = raw.toLowerCase();
    if (!/^[a-z][a-z0-9_]*$/.test(id)) throw new Error(`Invalid provider "${raw}" in PROVIDERS: letters, digits and underscores only`);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function readProviders(env: Record<string, string | undefined>): Provider[] {
  const providers: Provider[] = [];
  for (const id of providerIds(env)) {
    const prefix = id.toUpperCase();
    const built = BUILT_IN[id];
    const models: ModelSpec[] = [];
    for (const entry of (env[`${prefix}_MODELS`] || '').split(',').map(s => s.trim()).filter(Boolean)) {
      const spec = parseModel(entry);
      if (!models.some(m => m.name === spec.name)) models.push(spec);
    }
    const apiKey = env[`${prefix}_API_KEY`] || '';
    const baseUrl = (env[`${prefix}_BASE_URL`] || built?.baseUrl || '').replace(/\/+$/, '');
    const kind = (env[`${prefix}_KIND`] || built?.kind || 'openai').trim().toLowerCase();
    if (kind !== 'openai' && kind !== 'anthropic') throw new Error(`Invalid ${prefix}_KIND: openai or anthropic`);
    if (!models.length || !baseUrl || (built?.keyRequired && !apiKey)) continue;
    let url: URL;
    try { url = new URL(baseUrl); }
    catch { throw new Error(`Invalid ${prefix}_BASE_URL`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error(`Invalid ${prefix}_BASE_URL`);
    }
    providers.push({ id, name: env[`${prefix}_NAME`]?.trim() || built?.name || id, kind, baseUrl, apiKey, models });
  }
  return providers;
}
export function publicModels(providers: Provider[]): ModelOption[] {
  return providers.flatMap(p => p.models.map(m => ({
    id: `${p.id}:${m.name}`, name: m.name, provider: p.name,
    destination: new URL(p.baseUrl).host, window: m.window
  })));
}
export function resolveModel(providers: Provider[], id: string) {
  for (const provider of providers) {
    for (const m of provider.models) if (`${provider.id}:${m.name}` === id) return { provider, model: m.name, window: m.window };
  }
  return null;
}
