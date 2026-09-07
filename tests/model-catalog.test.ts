import { describe, expect, it, vi } from 'vitest';
import { publicModels, resolveModel } from '../src/lib/server/config';
import { chatInputSchema, contextBudget } from '../src/lib/server/context';
import { createModelCatalog, DISCOVERY_CACHE_MS, DISCOVERY_MAX_BYTES, DISCOVERY_MAX_MODELS, DISCOVERY_RETRY_MS } from '../src/lib/server/model-catalog';

const env = { COMPATIBLE_BASE_URL: 'https://fixture.test/private/v1/', COMPATIBLE_API_KEY: 'never-public' };
const response = (...ids: string[]) => Response.json({ data: ids.map(id => ({ id, context_length: 999999, secret: 'upstream-only' })) });

// Every catalog here receives a mock; no test contacts an inference server.
describe('model catalog discovery', () => {
  it('reads only GET <base>/models with upstream credentials and exposes only selected fields', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response('model', 'llama:8b', 'numeric:32000', 'model'));
    const catalog = createModelCatalog({ fetcher });
    const result = await catalog(env);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://fixture.test/private/v1/models', expect.objectContaining({
      method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer never-public' }, redirect: 'manual', signal: expect.any(AbortSignal)
    }));
    const models = publicModels(result.providers);
    expect(models.map(m => m.name)).toEqual(['model', 'llama:8b', 'numeric:32000']);
    expect(models.every(m => m.window === null)).toBe(true);
    const publicData = JSON.stringify({ models, modelConnections: result.connections });
    for (const secret of ['never-public', 'upstream-only', '/private/', 'context_length', 'apiKey']) expect(publicData).not.toContain(secret);
    expect(result.connections[0]).toMatchObject({ state: 'discovered', destination: 'fixture.test' });
    // The same catalog is used by bootstrap and chat; no manual-list parser
    // may strip a discovered model's numeric suffix.
    const chatCatalog = await catalog(env);
    for (const model of models) {
      expect(chatInputSchema.safeParse({ model: model.id, text: 'hello' }).success).toBe(true);
      expect(resolveModel(chatCatalog.providers, model.id)).toMatchObject({ model: model.name, window: null });
    }
    expect(contextBudget(32000, resolveModel(chatCatalog.providers, 'compatible:model')!.window).input).toBe(32000);
    expect(resolveModel(chatCatalog.providers, 'compatible:not-listed')).toBeNull();
    expect(resolveModel(chatCatalog.providers, 'other:model')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not probe unconfigured built-ins or Anthropic, and supports explicitly configured keyless services', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response('local'));
    const catalog = createModelCatalog({ fetcher });
    expect((await catalog({})).providers).toEqual([]);
    const anthropic = await catalog({ ANTHROPIC_API_KEY: 'secret' });
    expect(anthropic.connections[0]).toMatchObject({ state: 'manual', detail: expect.stringContaining('ANTHROPIC_MODELS') });
    expect(fetcher).not.toHaveBeenCalled();
    await catalog({ COMPATIBLE_BASE_URL: 'http://local.test/v1', COMPATIBLE_MODELS: '  ' });
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({ Accept: 'application/json' });
  });

  it('uses OpenAI defaults only when keyed and discovers named slots with their own credentials', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response('shared'));
    const result = await createModelCatalog({ fetcher })({
      OPENAI_API_KEY: 'openai-key', PROVIDERS: 'router', ROUTER_BASE_URL: 'https://router.test/api/v1', ROUTER_API_KEY: 'router-key'
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://api.openai.com/v1/models', 'https://router.test/api/v1/models']);
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer router-key' });
    expect(publicModels(result.providers).map(m => m.id)).toEqual(['openai:shared', 'router:shared']);
  });

  it('keeps explicit overrides authoritative and offline, including known windows', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    const catalog = createModelCatalog({ fetcher });
    const result = await catalog({ ...env, COMPATIBLE_MODELS: 'manual:8k,manual:8k,other' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.connections[0].state).toBe('explicit');
    expect(publicModels(result.providers).map(m => m.name)).toEqual(['manual', 'other']);
    expect(resolveModel(result.providers, 'compatible:manual')?.window).toBe(8000);
    expect(resolveModel(result.providers, 'compatible:discovered')).toBeNull();
  });

  it.each([
    ['bad JSON', () => new Response('{'), 'malformed JSON'],
    ['wrong shape', () => Response.json({ models: ['x'] }), 'data array'],
    ['non-array', () => Response.json({ data: {} }), 'data array'],
    ['null entry', () => Response.json({ data: [null] }), 'invalid model ID'],
    ['missing ID', () => Response.json({ data: [{}] }), 'invalid model ID'],
    ['number ID', () => Response.json({ data: [{ id: 7 }] }), 'invalid model ID'],
    ['empty ID', () => response(''), 'invalid model ID'],
    ['padded ID', () => response(' x '), 'invalid model ID'],
    ['control ID', () => response('x\ny'), 'invalid model ID'],
    ['long ID', () => response('x'.repeat(300)), 'invalid model ID'],
    ['too many models', () => Response.json({ data: Array.from({ length: DISCOVERY_MAX_MODELS + 1 }, (_, i) => ({ id: String(i) })) }), '2000-model limit'],
    ['large declared body', () => new Response('{}', { headers: { 'content-length': String(DISCOVERY_MAX_BYTES + 1) } }), '4 MiB limit'],
    ['large streamed body', () => new Response(new ReadableStream({ start(sink) {
      sink.enqueue(new Uint8Array(DISCOVERY_MAX_BYTES)); sink.enqueue(new Uint8Array(1)); sink.close();
    } })), '4 MiB limit']
  ])('fails safely for %s', async (_, makeResponse, detail) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(makeResponse());
    const result = await createModelCatalog({ fetcher })(env);
    expect(publicModels(result.providers)).toEqual([]);
    expect(result.connections[0]).toMatchObject({ state: 'error', detail: expect.stringContaining(detail) });
    expect(result.connections[0].detail).toContain('COMPATIBLE_MODELS');
  });

  it.each([301, 302, 307, 308, 401, 403, 404, 429, 500])('refuses HTTP %i without redirecting or downgrading auth', async status => {
    const cancel = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ cancel }), {
      status, headers: { Location: 'https://attacker.test/steal' }
    }));
    const result = await createModelCatalog({ fetcher })(env);
    expect(result.connections[0].state).toBe('error');
    expect(result.connections[0].detail).toContain(status < 400 ? 'redirect' : status === 401 || status === 403 ? 'credentials were rejected' : `HTTP ${status}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('manual');
    expect(cancel).toHaveBeenCalled();
    expect(JSON.stringify(result.connections)).not.toContain('attacker');
  });

  it('reports empty catalogs honestly and does not test generation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
    const result = await createModelCatalog({ fetcher })(env);
    expect(result.connections[0]).toMatchObject({ state: 'discovered', detail: expect.stringContaining('empty list') });
    expect(publicModels(result.providers)).toEqual([]);
    expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET' && !init.body)).toBe(true);
  });

  it.each(['fetch', 'body'])('times out stalled %s and cancels upstream work', async phase => {
    const cancel = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => phase === 'fetch'
      ? new Promise<Response>(() => {}) : new Response(new ReadableStream({ cancel })));
    const result = await createModelCatalog({ fetcher, timeoutMs: 10 })(env);
    expect(result.connections[0]).toMatchObject({ state: 'error', detail: expect.stringContaining('timed out') });
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    if (phase === 'body') expect(cancel).toHaveBeenCalled();
  });

  it('cancels a late response even if connecting ignored the abort signal', async () => {
    const cancel = vi.fn();
    let release!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const result = await createModelCatalog({ fetcher, timeoutMs: 10 })(env);
    expect(result.connections[0].state).toBe('error');
    release(new Response(new ReadableStream({ cancel })));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  });

  it('deduplicates concurrent callers, caches success, and refreshes after expiry', async () => {
    let now = 1000;
    let release!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
      .mockImplementation(async () => response('new'));
    const catalog = createModelCatalog({ fetcher, now: () => now });
    const a = catalog(env), b = catalog(env);
    expect(fetcher).toHaveBeenCalledTimes(1);
    release(response('old'));
    expect(await a).toEqual(await b);
    now += DISCOVERY_CACHE_MS - 1;
    expect(publicModels((await catalog(env)).providers)[0].name).toBe('old');
    expect(fetcher).toHaveBeenCalledTimes(1);
    now++;
    const refresh = await Promise.all([catalog(env), catalog(env)]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(publicModels(refresh[0].providers)[0].name).toBe('new');
  });

  it('caches failures briefly, isolates provider errors, and retains a known list on refresh failure', async () => {
    let now = 1000;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response('known'))
      .mockRejectedValue(new Error('secret URL and key must not be returned'));
    const catalog = createModelCatalog({ fetcher, now: () => now });
    await catalog(env);
    now += DISCOVERY_CACHE_MS;
    const mixed = { ...env, OPENAI_API_KEY: 'k', OPENAI_MODELS: 'offline:8k' };
    const failed = await catalog(mixed);
    expect(failed.connections[1]).toMatchObject({ state: 'stale', detail: expect.stringContaining('last successful list') });
    expect(resolveModel(failed.providers, 'compatible:known')?.model).toBe('known');
    expect(resolveModel(failed.providers, 'openai:offline')?.window).toBe(8000);
    expect(JSON.stringify(failed.connections)).not.toContain('secret URL');
    await catalog(mixed);
    expect(fetcher).toHaveBeenCalledTimes(2);
    now += DISCOVERY_RETRY_MS;
    await catalog(mixed);
    expect(fetcher).toHaveBeenCalledTimes(3);
    // A new key cannot inherit a list authenticated with the old key.
    const changed = await catalog({ ...env, COMPATIBLE_API_KEY: 'changed' });
    expect(changed.connections[0].state).toBe('error');
    expect(publicModels(changed.providers)).toEqual([]);
    await catalog({ ...env, COMPATIBLE_API_KEY: 'changed' });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('invalidates cache for endpoint changes, explicit overrides and removed configuration', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response('found'));
    const catalog = createModelCatalog({ fetcher });
    await catalog(env);
    await catalog({ ...env, COMPATIBLE_BASE_URL: 'https://other.test/v1' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const explicit = await catalog({ ...env, COMPATIBLE_MODELS: 'only' });
    expect(resolveModel(explicit.providers, 'compatible:found')).toBeNull();
    await catalog(env);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await catalog({});
    await catalog(env);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
