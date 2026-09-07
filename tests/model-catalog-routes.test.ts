import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { COMPATIBLE_BASE_URL: 'https://fixture.test/v1', COMPATIBLE_API_KEY: 'upstream-secret' },
  query: vi.fn(async () => ({ rows: [] })),
  connect: vi.fn(async () => { throw new Error('Selected model reached database transaction'); })
}));
vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));
vi.mock('../src/lib/server/db', () => ({ database: async () => ({ query: mocks.query, connect: mocks.connect }) }));
vi.mock('../src/lib/server/settings', () => ({ readSettings: async () => ({ systemPrompt: '', contextTokens: 32000, suggestions: [] }) }));

// Import routes only after replacing fetch: their shared catalog captures this
// mock. A valid chat stops before the transaction, so no generation is possible.
const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: [{ id: 'tag:32000' }] }));
let bootstrap: typeof import('../src/routes/api/bootstrap/+server');
let chat: typeof import('../src/routes/api/chat/+server');
beforeAll(async () => {
  vi.stubGlobal('fetch', fetcher);
  bootstrap = await import('../src/routes/api/bootstrap/+server');
  chat = await import('../src/routes/api/chat/+server');
});
afterAll(() => vi.unstubAllGlobals());
const principal = (scopes: string[]) => ({ kind: 'token', id: 'test', name: 'Test', scopes });
const bootEvent = (scopes: string[]) => ({ locals: { principal: principal(scopes) } }) as Parameters<typeof bootstrap.GET>[0];
const chatEvent = (scopes: string[], model = 'compatible:tag:32000') => ({
  locals: { principal: principal(scopes) }, request: new Request('https://app.test/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, text: 'hello' })
  })
}) as Parameters<typeof chat.POST>[0];

describe('model catalog route integration', () => {
  it('keeps scope checks ahead of discovery and does not let read tokens generate', async () => {
    await expect(bootstrap.GET(bootEvent(['write']))).rejects.toMatchObject({ status: 403 });
    await expect(chat.POST(chatEvent(['read']))).rejects.toMatchObject({ status: 403 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('publishes a safe bootstrap and resolves its exact discovered selection in chat using the same cache', async () => {
    const result = await (await bootstrap.GET(bootEvent(['read']))).json();
    expect(result.models).toEqual([{ id: 'compatible:tag:32000', name: 'tag:32000', provider: 'Custom endpoint', destination: 'fixture.test', window: null }]);
    expect(result.modelConnections[0].state).toBe('discovered');
    expect(JSON.stringify(result)).not.toContain('upstream-secret');
    expect(JSON.stringify(result)).not.toContain('apiKey');
    await expect(chat.POST(chatEvent(['generate'], result.models[0].id))).rejects.toThrow('Selected model reached database transaction');
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.method).toBe('GET');
  });

  it('rejects arbitrary IDs and browser URLs without a new upstream request', async () => {
    await expect(chat.POST(chatEvent(['generate'], 'compatible:not-in-catalog'))).rejects.toMatchObject({ status: 400 });
    await expect(chat.POST(chatEvent(['generate'], 'https://attacker.test/v1'))).rejects.toMatchObject({ status: 400 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
  });
});
