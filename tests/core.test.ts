import { describe, it, expect } from 'vitest';
import { readProviders, publicModels, resolveModel } from '../src/lib/server/config';
import { deviceLabel, equalSecret, hashSecret, newSecret, requireScope, requireSession, SCOPES, type Principal } from '../src/lib/server/auth';
import { assembleContext, chatInputSchema, contextBudget, estimateTokens, MAX_OUTPUT_TOKENS, THINKING_HEADROOM } from '../src/lib/server/context';
import { renderMarkdown } from '../src/lib/markdown';
import { eventData } from '../src/lib/sse';
import { generate, ProviderError, ThinkTags, type Piece } from '../src/lib/server/providers';
import type { Provider } from '../src/lib/server/config';

const provider: Provider = { id: 'compatible', kind: 'openai', name: 'Test', baseUrl: 'http://fixture/v1', apiKey: 'never-public', models: [{ name: 'test-model', window: null }] };
function stream(text: string, chunk = 3) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({ start(sink) { for (let i = 0; i < bytes.length; i += chunk) sink.enqueue(bytes.slice(i, i + chunk)); sink.close(); } });
}
async function collect<T>(input: AsyncIterable<T>) { const result: T[] = []; for await (const part of input) result.push(part); return result; }
/** The text of every piece a generation yielded, kinds aside. */
async function texts(input: AsyncIterable<Piece>) { return (await collect(input)).map(p => p.text); }
const think = (text: string): Piece => ({ kind: 'thinking', text });
const say = (text: string): Piece => ({ kind: 'text', text });
function mockResponse(text: string, type = 'text/event-stream'): typeof fetch {
  return (async () => new Response(stream(text), { headers: { 'Content-Type': type } })) as typeof fetch;
}
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;

describe('connection configuration', () => {
  it('includes configured slots without models for discovery, but never enables idle hosted slots', () => {
    expect(readProviders({})).toEqual([]);
    expect(readProviders({ OPENAI_MODELS: 'a', ANTHROPIC_BASE_URL: 'https://fixture/v1' })).toEqual([]);
    expect(readProviders({ OPENAI_API_KEY: 'key' })).toMatchObject([{ id: 'openai', models: [] }]);
  });
  it('supports a keyless local server and deduplicates model IDs', () => {
    const providers = readProviders({ COMPATIBLE_BASE_URL: 'http://embedder:11434/v1/', COMPATIBLE_MODELS: ' a, b, a ' });
    expect(providers[0].models.map(m => m.name)).toEqual(['a', 'b']); expect(providers[0].baseUrl).toBe('http://embedder:11434/v1');
    expect(providers[0].name).toBe('Custom endpoint');
    expect(readProviders({ COMPATIBLE_BASE_URL: 'http://x/v1', COMPATIBLE_MODELS: 'a', COMPATIBLE_NAME: ' Jalapeno ' })[0].name).toBe('Jalapeno');
  });
  it('reads a trailing numeric segment as the context window and leaves other colons alone', () => {
    const [p] = readProviders({ COMPATIBLE_BASE_URL: 'http://x/v1', COMPATIBLE_MODELS: 'gpt-5:400k, llama3.1:8b, qwen:32000, tag:7, ft:gpt-4o:org:abc' });
    expect(p.models).toEqual([
      { name: 'gpt-5', window: 400000 }, { name: 'llama3.1:8b', window: null }, { name: 'qwen', window: 32000 },
      { name: 'tag:7', window: null }, { name: 'ft:gpt-4o:org:abc', window: null }
    ]);
    expect(publicModels([p])[0]).toMatchObject({ id: 'compatible:gpt-5', name: 'gpt-5', window: 400000 });
    expect(resolveModel([p], 'compatible:llama3.1:8b')).toMatchObject({ model: 'llama3.1:8b', window: null });
    expect(resolveModel([p], 'compatible:qwen')?.window).toBe(32000);
  });
  it('reads any number of extra providers named in PROVIDERS, each from its own prefix', () => {
    const providers = readProviders({
      PROVIDERS: 'OpenRouter, ollama, openai',
      OPENAI_API_KEY: 'k', OPENAI_MODELS: 'gpt-5',
      OPENROUTER_NAME: 'OpenRouter', OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1/', OPENROUTER_API_KEY: 'k2', OPENROUTER_MODELS: 'anthropic/claude-sonnet-4:200k',
      OLLAMA_BASE_URL: 'http://host.docker.internal:11434/v1', OLLAMA_MODELS: 'llama3.1:8b:8k'
    });
    expect(providers.map(p => p.id)).toEqual(['openai', 'openrouter', 'ollama']);
    expect(providers[1]).toMatchObject({ name: 'OpenRouter', kind: 'openai', apiKey: 'k2', baseUrl: 'https://openrouter.ai/api/v1' });
    expect(providers[2]).toMatchObject({ name: 'ollama', kind: 'openai', apiKey: '', models: [{ name: 'llama3.1:8b', window: 8000 }] });
    expect(publicModels(providers).map(m => m.id)).toEqual(['openai:gpt-5', 'openrouter:anthropic/claude-sonnet-4', 'ollama:llama3.1:8b']);
  });
  it('lets an extra slot speak the Anthropic protocol, and rejects unknown kinds and unusable names', () => {
    expect(readProviders({ PROVIDERS: 'proxy', PROXY_KIND: 'anthropic', PROXY_BASE_URL: 'https://p/v1', PROXY_MODELS: 'claude' })[0].kind).toBe('anthropic');
    expect(() => readProviders({ PROVIDERS: 'proxy', PROXY_KIND: 'grpc', PROXY_BASE_URL: 'https://p/v1', PROXY_MODELS: 'x' })).toThrow('PROXY_KIND');
    expect(() => readProviders({ PROVIDERS: 'open-router' })).toThrow('PROVIDERS');
    expect(() => readProviders({ PROVIDERS: 'p', P_BASE_URL: 'not a url', P_MODELS: 'x' })).toThrow('P_BASE_URL');
  });
  it('does not expose keys or paths in model metadata', () => {
    expect(JSON.stringify(publicModels([provider]))).not.toContain('never-public');
    expect(publicModels([provider])[0].destination).toBe('fixture');
  });
  it('rejects credential-bearing or non-HTTP endpoints', () => {
    for (const base of ['file:///tmp/a', 'https://key:secret@example.org', 'https://example.org/?token=secret']) {
      expect(() => readProviders({ COMPATIBLE_BASE_URL: base, COMPATIBLE_MODELS: 'x' })).toThrow();
    }
  });
  it('only resolves models explicitly permitted by the server', () => {
    expect(resolveModel([provider], 'compatible:test-model')?.model).toBe('test-model');
    expect(resolveModel([provider], 'compatible:other')).toBeNull();
  });
});
describe('credentials', () => {
  it('compares secrets without length-dependent timing comparison', () => { expect(equalSecret('a', 'a')).toBe(true); expect(equalSecret('a', 'aaaa')).toBe(false); });
  it('mints unguessable secrets and stores only their digest', () => {
    const a = newSecret(), b = newSecret();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hashSecret(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecret(a)).not.toContain(a);
    expect(hashSecret(a)).toBe(hashSecret(a));
    expect(hashSecret(a)).not.toBe(hashSecret(b));
  });
  it('names a device from what the browser said, and never fails to name one', () => {
    expect(deviceLabel('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')).toBe('Chrome on Linux');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iPhone');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0')).toBe('Edge on Windows');
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; rv:133.0) Gecko/20100101 Firefox/133.0')).toBe('Firefox on macOS');
    expect(deviceLabel('curl/8.5.0')).toBe('curl');
    expect(deviceLabel(null)).toBe('Unknown browser');
    expect(deviceLabel('')).toBe('Unknown browser');
    expect(deviceLabel('x'.repeat(5000))).toBe('Unknown browser');
  });
});

describe('scopes', () => {
  const session: Principal = { kind: 'session', id: 's', name: 'Chrome on Linux', scopes: [...SCOPES] };
  const readOnly: Principal = { kind: 'token', id: 't', name: 'Reader', scopes: ['read'] };
  const status = (run: () => unknown) => { try { run(); return 200; } catch (err) { return (err as { status: number }).status; } };

  it('gives a browser session every scope', () => {
    for (const scope of SCOPES) expect(requireScope({ locals: { principal: session, peerTrusted: false } }, scope)).toBe(session);
  });
  it('separates "not signed in" from "not allowed"', () => {
    expect(status(() => requireScope({ locals: { principal: null, peerTrusted: false } }, 'read'))).toBe(401);
    expect(status(() => requireScope({ locals: { principal: readOnly, peerTrusted: false } }, 'read'))).toBe(200);
    expect(status(() => requireScope({ locals: { principal: readOnly, peerTrusted: false } }, 'generate'))).toBe(403);
    expect(status(() => requireScope({ locals: { principal: readOnly, peerTrusted: false } }, 'admin'))).toBe(403);
  });
  it('keeps a token out of the routes that manage credentials, however many scopes it holds', () => {
    const powerful: Principal = { kind: 'token', id: 't2', name: 'All', scopes: [...SCOPES] };
    expect(status(() => requireSession({ locals: { principal: powerful, peerTrusted: false } }))).toBe(403);
    expect(status(() => requireSession({ locals: { principal: null, peerTrusted: false } }))).toBe(401);
    expect(requireSession({ locals: { principal: session, peerTrusted: false } })).toBe(session);
  });
});
describe('context selection', () => {
  it('includes project instructions and current user input', () => {
    const result = assembleContext([{ role: 'user', content: 'Hello', status: 'complete' }], 'Use Italian.');
    expect(result.turns[0].content).toContain('Use Italian.'); expect(result.turns[1].content).toBe('Hello'); expect(result.manifest.project).toBe(true);
  });
  it('puts the instance system prompt ahead of project instructions, or the base line when unset', () => {
    const custom = assembleContext([{ role: 'user', content: 'Hi', status: 'complete' }], 'Use Italian.', 'Be terse.');
    expect(custom.turns[0].content).toBe('Be terse.\n\nUse Italian.'); expect(custom.manifest.system).toBe(true);
    const base = assembleContext([{ role: 'user', content: 'Hi', status: 'complete' }], '', '   ');
    expect(base.turns[0].content).toContain('helpful assistant'); expect(base.manifest.system).toBe(false);
  });
  it('excludes failed or cancelled assistant output', () => {
    const result = assembleContext([{ role: 'user', content: 'Hello', status: 'complete' }, { role: 'assistant', content: 'wrong partial', status: 'cancelled' }, { role: 'user', content: 'Again', status: 'complete' }], '');
    expect(result.turns.map(m => m.content).join(' ')).not.toContain('wrong partial');
  });
  it('drops whole oldest exchanges to fit the token budget, and reports the estimate', () => {
    const result = assembleContext([{ role: 'user', content: 'x'.repeat(7000), status: 'complete' }, { role: 'assistant', content: 'old answer', status: 'complete' }, { role: 'user', content: 'latest', status: 'complete' }], '', '', 1000);
    expect(result.turns.at(-1)?.content).toBe('latest'); expect(result.turns.length).toBe(2); expect(result.manifest.truncated).toBe(true);
    expect(result.manifest.budget).toBe(1000); expect(result.manifest.tokens).toBe(estimateTokens(result.turns[0].content) + estimateTokens('latest'));
    const whole = assembleContext([{ role: 'user', content: 'a', status: 'complete' }, { role: 'assistant', content: 'b', status: 'complete' }, { role: 'user', content: 'c', status: 'complete' }], '', '', 1000);
    expect(whole.turns.length).toBe(4); expect(whole.manifest.truncated).toBe(false);
  });
  it('always sends the newest exchange, even over budget', () => {
    const result = assembleContext([{ role: 'user', content: 'x'.repeat(7000), status: 'complete' }], '', '', 1000);
    expect(result.turns.length).toBe(2); expect(result.manifest.tokens).toBeGreaterThan(1000);
  });
  it('estimates tokens from characters on the conservative side', () => {
    expect(estimateTokens('')).toBe(0); expect(estimateTokens('abcdefg')).toBe(2); expect(estimateTokens('日本語')).toBe(3); expect(estimateTokens('caffè')).toBe(3);
  });
  it('bounds the input by the ceiling, or by a declared window less the reply', () => {
    expect(contextBudget(32000, null)).toEqual({ input: 32000, output: MAX_OUTPUT_TOKENS });
    expect(contextBudget(32000, 200000)).toEqual({ input: 32000, output: MAX_OUTPUT_TOKENS });
    expect(contextBudget(1_000_000, 200000)).toEqual({ input: 176313, output: MAX_OUTPUT_TOKENS });
    expect(contextBudget(32000, 4096)).toEqual({ input: 2764, output: 1024 });
  });
  it('keeps room for thinking in the reply, within a quarter of a declared window', () => {
    expect(THINKING_HEADROOM).toBe(16384);
    expect(contextBudget(32000, null, 16384)).toEqual({ input: 32000, output: 4096 + 16384 });
    expect(contextBudget(32000, 32000, 16384)).toEqual({ input: Math.min(32000, Math.floor((32000 - 8000) * 0.9)), output: 8000 });
    expect(contextBudget(32000, 200000, 16384)).toEqual({ input: 32000, output: 4096 + 16384 });
  });
});
describe('chat input', () => {
  const uuid = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
  it('needs text for a plain send, and a uuid for the parent it follows', () => {
    expect(chatInputSchema.safeParse({ model: 'x' }).success).toBe(false);
    expect(chatInputSchema.safeParse({ model: 'x', text: 'hi' }).success).toBe(true);
    expect(chatInputSchema.safeParse({ model: 'x', text: 'hi', conversationId: uuid, parentId: other }).success).toBe(true);
    expect(chatInputSchema.safeParse({ model: 'x', text: 'hi', conversationId: uuid, parentId: 'not-a-uuid' }).success).toBe(false);
  });
  it('lets a regeneration carry nothing but the conversation and the answer to redo', () => {
    expect(chatInputSchema.safeParse({ conversationId: uuid, model: 'x', regenerate: other }).success).toBe(true);
    expect(chatInputSchema.safeParse({ model: 'x', regenerate: other }).success).toBe(false);
    expect(chatInputSchema.safeParse({ conversationId: uuid, model: 'x', regenerate: other, text: 'hi' }).success).toBe(false);
    expect(chatInputSchema.safeParse({ conversationId: uuid, model: 'x', regenerate: other, sources: ['a'] }).success).toBe(false);
    expect(chatInputSchema.safeParse({ conversationId: uuid, model: 'x', regenerate: other, parentId: uuid }).success).toBe(false);
    expect(chatInputSchema.safeParse({ conversationId: uuid, model: 'x', regenerate: 'nope' }).success).toBe(false);
  });
});
describe('markdown safety', () => {
  it('renders headings, lists and code', () => { const html = renderMarkdown('# Hello\n\n- a\n\n```js\nalert(1)\n```'); expect(html).toContain('<h1>Hello</h1>'); expect(html).toContain('language-js'); });
  it('removes executable HTML, remote images, styles and unsafe URLs', () => {
    const html = renderMarkdown('<script>alert(1)</script><img src="https://tracker" onerror="alert(1)"><iframe src="x"></iframe>\n\n[x](javascript:alert%281%29)\n\n<span style="color:red">text</span>');
    expect(html).not.toMatch(/<script|<img|<iframe|javascript:|style=/); expect(html).toContain('text');
  });
  it('adds external link protections', () => expect(renderMarkdown('[safe](https://example.org)')).toContain('rel="noopener noreferrer"'));
});
describe('SSE framing', () => {
  it('handles byte-split Unicode, CRLF, comments and multiline data', async () => {
    expect(await collect(eventData(stream(': ping\r\ndata: héllo 🪐\r\ndata: world\r\n\r\n', 1)))).toEqual(['héllo 🪐\nworld']);
  });
  it('does not dispatch an unterminated tail', async () => expect(await collect(eventData(stream('data: incomplete')))).toEqual([]));
  it('rejects unbounded events', async () => expect(collect(eventData(stream('data: ' + 'x'.repeat(1_048_577), 1_048_577)))).rejects.toThrow('size limit'));
});
describe('provider adapters', () => {
  const turns = [{ role: 'user' as const, content: 'Hi' }];
  it('streams OpenAI-compatible deltas', async () => {
    const fetcher = mockResponse(frame({ choices: [{ delta: { content: 'Hello' } }] }) + 'data: [DONE]\n\n');
    expect(await collect(generate(provider, 'test-model', turns, new AbortController().signal, { fetcher: fetcher }))).toEqual([say('Hello')]);
  });
  it('requires explicit completion instead of marking truncated data successful', async () => {
    const fetcher = mockResponse(frame({ choices: [{ delta: { content: 'partial' } }] }));
    await expect(collect(generate(provider, 'test-model', turns, new AbortController().signal, { fetcher: fetcher }))).rejects.toThrow('disconnected');
  });
  it('rejects bad JSON and non-SSE endpoints', async () => {
    await expect(collect(generate(provider, 'test-model', turns, new AbortController().signal, { fetcher: mockResponse('data: not-json\n\n') }))).rejects.toThrow('malformed');
    await expect(collect(generate(provider, 'test-model', turns, new AbortController().signal, { fetcher: mockResponse('{}', 'application/json') }))).rejects.toThrow('SSE');
  });
  it('does not expose raw upstream error bodies or credentials', async () => {
    const fetcher = (async () => new Response('secret upstream details', { status: 401 })) as typeof fetch;
    await expect(collect(generate(provider, 'test-model', turns, new AbortController().signal, { fetcher: fetcher }))).rejects.toThrow('credentials');
    await expect(collect(generate(provider, 'test-model', turns, new AbortController().signal, { fetcher: fetcher }))).rejects.not.toThrow('secret upstream');
  });
  it('preserves partial output but reports output limit failures', async () => {
    const fetcher = mockResponse(frame({ choices: [{ delta: { content: 'partial' } }] }) + frame({ choices: [{ finish_reason: 'length' }] }));
    await expect(collect(generate(provider, 'test-model', turns, new AbortController().signal, { fetcher: fetcher }))).rejects.toThrow('output limit');
  });
  it('translates Anthropic system instructions, auth and delta events', async () => {
    let sent: RequestInit | undefined;
    const fetcher = (async (_url, init) => { sent = init; return new Response(stream(frame({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Ciao' } }) + frame({ type: 'message_stop' })), { headers: { 'Content-Type': 'text/event-stream' } }); }) as typeof fetch;
    const result = await texts(generate({ ...provider, kind: 'anthropic' }, 'claude', [{ role: 'system', content: 'Italian' }, ...turns], new AbortController().signal, { fetcher: fetcher }));
    expect(result).toEqual(['Ciao']); expect(JSON.parse(sent!.body as string)).not.toHaveProperty('thinking'); expect(JSON.parse(sent!.body as string).system).toBe('Italian'); expect(JSON.parse(sent!.body as string).max_tokens).toBe(MAX_OUTPUT_TOKENS); expect((sent!.headers as Record<string, string>)['x-api-key']).toBe('never-public');
  });
  it('reports Anthropic output exhaustion and unsupported tool calls', async () => {
    const anthro = mockResponse(frame({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }));
    await expect(collect(generate({ ...provider, kind: 'anthropic' }, 'claude', turns, new AbortController().signal, { fetcher: anthro }))).rejects.toThrow('output limit');
    const tools = mockResponse(frame({ choices: [{ finish_reason: 'tool_calls' }] }));
    await expect(collect(generate(provider, 'test-model', turns, new AbortController().signal, { fetcher: tools }))).rejects.toThrow('Tool execution');
  });
  it('asks native OpenAI for max_completion_tokens and every other OpenAI-style slot for max_tokens', async () => {
    const seen: string[] = [];
    const fetcher = (async (_url, init) => {
      seen.push(Object.keys(JSON.parse(init!.body as string)).filter(k => k.startsWith('max_')).join());
      return new Response(stream(frame({ choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] })), { headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch;
    await collect(generate({ ...provider, id: 'openai' }, 'm', turns, new AbortController().signal, { fetcher }));
    await collect(generate({ ...provider, id: 'openrouter' }, 'm', turns, new AbortController().signal, { fetcher }));
    expect(seen).toEqual(['max_completion_tokens', 'max_tokens']);
  });
  it('reports stream errors as safe failures', async () => {
    const fetcher = mockResponse(frame({ type: 'error', error: { message: 'private-detail' } }));
    await expect(collect(generate(provider, 'test-model', turns, new AbortController().signal, { fetcher: fetcher }))).rejects.toBeInstanceOf(ProviderError);
  });
  it('tells OpenAI-style reasoning deltas apart from the answer, under either name', async () => {
    const fetcher = mockResponse(
      frame({ choices: [{ delta: { reasoning_content: '' } }] }) + frame({ choices: [{ delta: { reasoning_content: 'why' } }] })
      + frame({ choices: [{ delta: { reasoning: ' not' } }] }) + frame({ choices: [{ delta: { reasoning: null, content: 'Hello' } }] })
      + frame({ choices: [{ delta: {}, finish_reason: 'stop' }] })
    );
    expect(await collect(generate(provider, 'test-model', turns, new AbortController().signal, { fetcher }))).toEqual([think(''), think('why'), think(' not'), say('Hello')]);
  });
  it('reads <think> tags left in the answer, however the chunks fall', async () => {
    const chunks = ['<th', 'ink>rea', 'soning</thi', 'nk>\n\nAnswer'];
    const fetcher = mockResponse(chunks.map(c => frame({ choices: [{ delta: { content: c } }] })).join('') + frame({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
    expect(await collect(generate(provider, 'test-model', turns, new AbortController().signal, { fetcher }))).toEqual([think(''), think('rea'), think('soning'), say('Answer')]);
  });
  it('splits tagged reasoning from text at every awkward point, and only at the start', () => {
    const run = (chunks: string[]) => { const t = new ThinkTags(); return [...chunks.flatMap(c => t.push(c)), ...t.flush()]; };
    expect(run(['<th', 'ink>rea', 'soning</thi', 'nk>\n\nAnswer'])).toEqual([think(''), think('rea'), think('soning'), say('Answer')]);
    expect(run(['<think>a</think>b'])).toEqual([think(''), think('a'), say('b')]);
    expect(run(['<think>', 'a', '</think>', '\n', '\n', 'b'])).toEqual([think(''), think('a'), say('b')]);
    expect(run(['  \n', '<think>a</think> b'])).toEqual([think(''), think('a'), say('b')]);
    expect(run(['Here is code: <think>x</think>'])).toEqual([say('Here is code: <think>x</think>')]);
    expect(run(['Hel', 'lo'])).toEqual([say('Hel'), say('lo')]);
    expect(run(['<thinks are fine'])).toEqual([say('<thinks are fine')]);
    expect(run(['<think>never closed', ' at all'])).toEqual([think(''), think('never closed'), think(' at all')]);
    expect(run(['<think>tail</thi'])).toEqual([think(''), think('tail'), think('</thi')]);
    const held = new ThinkTags(); expect(held.push('<thi')).toEqual([]); expect(held.flush()).toEqual([say('<thi')]); expect(held.flush()).toEqual([]);
    expect(run([''])).toEqual([]);
  });
  it('streams Anthropic thinking blocks, shown or redacted, ahead of the answer', async () => {
    const fetcher = mockResponse(
      frame({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } })
      + frame({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } })
      + frame({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } })
      + frame({ type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: 'x' } })
      + frame({ type: 'content_block_start', index: 2, content_block: { type: 'text', text: '' } })
      + frame({ type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Ciao' } })
      + frame({ type: 'message_stop' })
    );
    expect(await collect(generate({ ...provider, kind: 'anthropic' }, 'claude', turns, new AbortController().signal, { fetcher }))).toEqual([think(''), think('hmm'), think(''), say('Ciao')]);
  });
  it('asks Claude to think adaptively only when told to, and names the setting when that is refused', async () => {
    const bodies: Record<string, unknown>[] = [];
    const ok = (async (_url, init) => { bodies.push(JSON.parse(init!.body as string)); return new Response(stream(frame({ type: 'message_stop' })), { headers: { 'Content-Type': 'text/event-stream' } }); }) as typeof fetch;
    await collect(generate({ ...provider, kind: 'anthropic' }, 'claude', turns, new AbortController().signal, { fetcher: ok, thinking: true }));
    await collect(generate({ ...provider, kind: 'anthropic' }, 'claude', turns, new AbortController().signal, { fetcher: ok }));
    const openai = (async (_url, init) => { bodies.push(JSON.parse(init!.body as string)); return new Response(stream(frame({ choices: [{ delta: {}, finish_reason: 'stop' }] })), { headers: { 'Content-Type': 'text/event-stream' } }); }) as typeof fetch;
    await collect(generate(provider, 'test-model', turns, new AbortController().signal, { fetcher: openai, thinking: true }));
    expect(bodies[0].thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(bodies[1]).not.toHaveProperty('thinking'); expect(bodies[2]).not.toHaveProperty('thinking');
    const refused = (async () => new Response('bad request', { status: 400 })) as typeof fetch;
    await expect(collect(generate({ ...provider, kind: 'anthropic' }, 'claude', turns, new AbortController().signal, { fetcher: refused, thinking: true }))).rejects.toThrow('Settings → Chat');
    await expect(collect(generate({ ...provider, kind: 'anthropic' }, 'claude', turns, new AbortController().signal, { fetcher: refused }))).rejects.toThrow('HTTP 400');
    await expect(collect(generate({ ...provider, kind: 'anthropic' }, 'claude', turns, new AbortController().signal, { fetcher: refused }))).rejects.not.toThrow('Settings');
  });
});
