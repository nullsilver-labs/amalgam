import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bootstrap, ChatEvent, Conversation, Message, ModelOption } from '../src/lib/types';
import { DEFAULT_SETTINGS } from '../src/lib/types';

/*
 * A conversation is a tree; the transcript reads one path through it. These
 * pin the path arithmetic, the branch switch, and the one run loop that
 * both a send and an "answer again" stream through.
 */

const mocks = vi.hoisted(() => ({ api: vi.fn(), replaceState: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: mocks.api }));
vi.mock('$app/navigation', () => ({ replaceState: mocks.replaceState }));

const modelA: ModelOption = { id: 'local:a', name: 'a', provider: 'Local', destination: 'a.test', window: 8000, kind: 'openai' };
const modelB: ModelOption = { id: 'local:b', name: 'b', provider: 'Local', destination: 'b.test', window: null, kind: 'openai' };
const CHAT = 'chat-1';
const conversation = (leaf_id: string | null = null): Conversation => ({ id: CHAT, title: 'Branches', project_id: null, created_at: '', updated_at: '', leaf_id });
function message(id: string, role: 'user' | 'assistant', parent_id: string | null, extra: Partial<Message> = {}): Message {
  return {
    id, conversation_id: CHAT, role, content: id, status: 'complete', model: role === 'assistant' ? modelA.id : null,
    error: null, created_at: '', sources: null, parent_id, thinking: null, thinking_ms: null,
    input_tokens: null, output_tokens: null, tokens_estimated: null, first_token_ms: null, duration_ms: null, ...extra
  };
}
/* u1 → a1 and a2 (branches); a2 → u2 → a3. Written in this order. */
const u1 = message('u1', 'user', null);
const a1 = message('a1', 'assistant', 'u1');
const a2 = message('a2', 'assistant', 'u1');
const u2 = message('u2', 'user', 'a2');
const a3 = message('a3', 'assistant', 'u2');
const tree = () => [u1, a1, a2, u2, a3].map(m => ({ ...m }));
function bootstrap(): Bootstrap {
  return {
    conversations: [conversation('a1')], projects: [], models: [modelA, modelB],
    modelConnections: [{ id: 'local', name: 'Local', destination: 'a.test', state: 'explicit', detail: 'Manual list.', checkedAt: null }],
    integrations: { corpus: { configured: false, publicUrl: '' }, embeddings: false }, settings: DEFAULT_SETTINGS
  };
}
function storage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; }, clear: () => data.clear(),
    getItem: key => data.get(key) ?? null, key: index => [...data.keys()][index] ?? null,
    removeItem: key => { data.delete(key); }, setItem: (key, value) => { data.set(key, value); }
  };
}
/** What /api/chat answers: the events, framed as SSE. */
function sse(events: ChatEvent[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(sink) { for (const event of events) sink.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); sink.close(); }
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}
const sent = (call: number) => JSON.parse(String(fetcher.mock.calls[call][1]?.body));

let store: typeof import('../src/lib/state/workspace.svelte');
let workspace: typeof store.workspace;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
let leaf: string | null;

beforeEach(async () => {
  vi.resetModules();
  mocks.api.mockReset();
  mocks.replaceState.mockReset();
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('sessionStorage', storage());
  vi.stubGlobal('location', new URL('https://app.test/'));
  fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('Unexpected generation request'));
  vi.stubGlobal('fetch', fetcher);
  leaf = 'a1';
  mocks.api.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/bootstrap') return bootstrap();
    if (path === `/api/conversations/${CHAT}`) {
      if (init?.method === 'PATCH') { leaf = JSON.parse(String(init.body)).leafId ?? leaf; return conversation(leaf); }
      return { conversation: conversation(leaf), messages: tree() };
    }
    throw new Error(`Unexpected API request: ${path}`);
  });
  store = await import('../src/lib/state/workspace.svelte');
  workspace = store.workspace;
}, 60_000);
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const ids = (list: Message[]) => list.map(m => m.id);

describe('the path through a conversation', () => {
  it('walks from the leaf to the root, and falls back to the newest message', () => {
    const all = tree();
    expect(ids(store.threadOf(all, 'a3'))).toEqual(['u1', 'a2', 'u2', 'a3']);
    expect(ids(store.threadOf(all, 'a1'))).toEqual(['u1', 'a1']);
    expect(ids(store.threadOf(all, 'missing'))).toEqual(['u1', 'a2', 'u2', 'a3']);
    expect(ids(store.threadOf(all, null))).toEqual(['u1', 'a2', 'u2', 'a3']);
    expect(store.threadOf([], 'a1')).toEqual([]);
  });
  it('reads rows from before branching one message at a time, parent or no parent field', () => {
    const legacy = [message('x', 'user', null), message('y', 'assistant', null)];
    expect(ids(store.threadOf(legacy, null))).toEqual(['y']);
    const untyped = legacy.map(m => { const { parent_id: _omitted, ...rest } = m; return rest as Message; });
    expect(ids(store.threadOf(untyped, 'x'))).toEqual(['x']);
  });
  it('knows the branches at a point and the newest end below one', () => {
    const all = tree();
    expect(ids(store.siblingsOf(all, a1))).toEqual(['a1', 'a2']);
    expect(ids(store.siblingsOf(all, u1))).toEqual(['u1']);
    expect(store.tipOf(all, a2).id).toBe('a3');
    expect(store.tipOf(all, a1).id).toBe('a1');
    expect(store.tipOf(all, u1).id).toBe('a3');
  });
});

describe('reading and switching branches', () => {
  it('opens a conversation at the branch it was last read at', async () => {
    await workspace.boot();
    await workspace.open(CHAT);
    expect(ids(workspace.messages)).toEqual(['u1', 'a1']);
    expect(workspace.active.messages).toHaveLength(5);
    expect(workspace.active.leafId).toBe('a1');
    expect(workspace.active.branch(workspace.messages[1])).toEqual({ index: 0, count: 2 });
    expect(workspace.active.branch(workspace.messages[0])).toEqual({ index: 0, count: 1 });
  });
  it('switches to the next branch down to its newest end, and tells the server', async () => {
    await workspace.boot();
    await workspace.open(CHAT);
    const shownA1 = workspace.messages[1];
    await workspace.switchBranch(shownA1, 1);
    expect(workspace.active.leafId).toBe('a3');
    expect(ids(workspace.messages)).toEqual(['u1', 'a2', 'u2', 'a3']);
    const patch = mocks.api.mock.calls.find(([path, init]) => path === `/api/conversations/${CHAT}` && init?.method === 'PATCH');
    expect(patch).toBeDefined();
    expect(JSON.parse(String(patch![1].body))).toEqual({ leafId: 'a3' });
    expect(workspace.current?.leaf_id).toBe('a3');
    expect(workspace.active.branch(workspace.messages[1])).toEqual({ index: 1, count: 2 });
    // Back again, from the answer now shown at that point.
    await workspace.switchBranch(workspace.messages[1], -1);
    expect(ids(workspace.messages)).toEqual(['u1', 'a1']);
  });
  it('does nothing past the last branch, and asks the server nothing', async () => {
    await workspace.boot();
    await workspace.open(CHAT);
    const before = mocks.api.mock.calls.length;
    await workspace.switchBranch(workspace.messages[1], -1);
    await workspace.switchBranch(workspace.messages[0], 1);
    expect(workspace.active.leafId).toBe('a1');
    expect(mocks.api.mock.calls.length).toBe(before);
  });
  it('survives a reload on the branch the server remembers', async () => {
    await workspace.boot();
    await workspace.open(CHAT);
    await workspace.switchBranch(workspace.messages[1], 1);
    await workspace.reload();
    expect(ids(workspace.messages)).toEqual(['u1', 'a2', 'u2', 'a3']);
  });
});

describe('the run loop', () => {
  it('sends after the leaf being read and streams thinking, then the answer, into the new turn', async () => {
    await workspace.boot();
    await workspace.open(CHAT);
    workspace.draft = 'Follow up';
    const u3 = message('u3', 'user', 'a1', { content: 'Follow up' });
    const a4 = message('a4', 'assistant', 'u3', { content: '', status: 'streaming' });
    fetcher.mockResolvedValueOnce(sse([
      { type: 'start', conversation: conversation('a4'), user: u3, assistant: a4, context: { messages: 3, truncated: false, project: false, system: false, tokens: 10, budget: 32000, window: 8000 } },
      { type: 'thinking', text: '' },
      { type: 'thinking', text: 'consider' },
      { type: 'thinking', text: ' this' },
      { type: 'delta', text: 'Hel' },
      { type: 'delta', text: 'lo' },
      { type: 'done', status: 'complete', thinking_ms: 1234 }
    ]));
    await workspace.send();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sent(0)).toEqual({ conversationId: CHAT, projectId: null, model: modelA.id, text: 'Follow up', parentId: 'a1' });
    expect(workspace.draft).toBe('');
    expect(workspace.active.leafId).toBe('a4');
    expect(workspace.current?.leaf_id).toBe('a4');
    expect(ids(workspace.messages)).toEqual(['u1', 'a1', 'u3', 'a4']);
    expect(workspace.active.messages).toHaveLength(7);
    const written = workspace.messages[3];
    expect(written.thinking).toBe('consider this');
    expect(written.content).toBe('Hello');
    expect(written.status).toBe('complete');
    expect(written.error).toBeNull();
    expect(written.thinking_ms).toBe(1234);
    expect(workspace.active.busy).toBe(false);
    expect(workspace.contextInfo?.messages).toBe(3);
    expect(workspace.data.conversations[0].leaf_id).toBe('a4');
  });
  it('counts thinking from the request to the first character of the answer when the server says nothing', async () => {
    await workspace.boot();
    await workspace.open(CHAT);
    workspace.draft = 'Timed';
    const u3 = message('u3', 'user', 'a1', { content: 'Timed' });
    const a4 = message('a4', 'assistant', 'u3', { content: '', status: 'streaming' });
    let clock = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const encoder = new TextEncoder();
    const frames: ChatEvent[] = [
      { type: 'start', conversation: conversation('a4'), user: u3, assistant: a4, context: { messages: 1, truncated: false, project: false, system: false, tokens: 1, budget: 32000, window: null } },
      { type: 'thinking', text: '' },
      { type: 'delta', text: 'A' },
      { type: 'delta', text: 'B' },
      { type: 'done', status: 'complete' }
    ];
    // Each frame arrives on its own read, the clock moving between them.
    const body = new ReadableStream<Uint8Array>({
      pull(sink) {
        const next = frames.shift();
        if (!next) { sink.close(); return; }
        clock += 500;
        sink.enqueue(encoder.encode(`data: ${JSON.stringify(next)}\n\n`));
      }
    });
    fetcher.mockResolvedValueOnce(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    await workspace.send();
    const written = workspace.messages[3];
    expect(written.thinking).toBe('');
    expect(written.content).toBe('AB');
    // The clock advanced on the thinking frame and once more on the first delta; nothing later moves it.
    expect(written.thinking_ms).toBe(1000);
    expect(written.status).toBe('complete');
  });
  it('answers again beside the answer, with the chosen model, without doubling the message it answers', async () => {
    await workspace.boot();
    await workspace.open(CHAT);
    const a4 = message('a4', 'assistant', 'u1', { content: '', status: 'streaming', model: modelB.id });
    fetcher.mockResolvedValueOnce(sse([
      { type: 'start', conversation: conversation('a4'), user: { ...u1 }, assistant: a4, context: { messages: 1, truncated: false, project: false, system: false, tokens: 1, budget: 32000, window: null } },
      { type: 'delta', text: 'Again' },
      { type: 'done', status: 'complete' }
    ]));
    workspace.draft = 'kept';
    await workspace.regenerate(workspace.messages[1], modelB.id);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sent(0)).toEqual({ conversationId: CHAT, model: modelB.id, regenerate: 'a1' });
    expect(workspace.model).toBe(modelB.id);
    expect(workspace.draft).toBe('kept');
    expect(workspace.active.messages.filter(m => m.id === 'u1')).toHaveLength(1);
    expect(workspace.active.messages).toHaveLength(6);
    expect(ids(workspace.messages)).toEqual(['u1', 'a4']);
    expect(workspace.messages[1].content).toBe('Again');
    expect(workspace.messages[1].thinking).toBeNull();
    expect(workspace.messages[1].thinking_ms).toBeNull();
    expect(workspace.active.branch(workspace.messages[1])).toEqual({ index: 2, count: 3 });
    expect(workspace.active.leafId).toBe('a4');
    // Later branches at that point are one step back.
    await workspace.switchBranch(workspace.messages[1], -1);
    expect(ids(workspace.messages)).toEqual(['u1', 'a2', 'u2', 'a3']);
  });
  it('sends a message again with other words beside the original, under the same parent, and carries the tab\'s thinking choice', async () => {
    await workspace.boot();
    await workspace.open(CHAT);
    await workspace.switchBranch(workspace.messages[1], 1);
    expect(ids(workspace.messages)).toEqual(['u1', 'a2', 'u2', 'a3']);
    // u2 follows a2; its edit is a new turn under a2, and the root's edit a new turn under nothing.
    const u3 = message('u3', 'user', 'a2', { content: 'Said differently' });
    const a5 = message('a5', 'assistant', 'u3', { content: '', status: 'streaming', model: modelA.id });
    fetcher.mockResolvedValueOnce(sse([
      { type: 'start', conversation: conversation('a5'), user: u3, assistant: a5, context: { messages: 1, truncated: false, project: false, system: false, tokens: 1, budget: 32000, window: null } },
      { type: 'delta', text: 'New answer' },
      { type: 'done', status: 'complete' }
    ]));
    workspace.setThinking(false);
    workspace.draft = 'kept';
    await workspace.edit(workspace.messages[2], '  Said differently ');
    expect(sent(0)).toEqual({ conversationId: CHAT, projectId: null, model: modelA.id, text: 'Said differently', parentId: 'a2', thinking: false });
    expect(workspace.draft).toBe('kept');
    expect(ids(workspace.messages)).toEqual(['u1', 'a2', 'u3', 'a5']);
    expect(workspace.messages[3].content).toBe('New answer');
    expect(workspace.active.branch(workspace.messages[2])).toEqual({ index: 1, count: 2 });
    // The root edited names the root as its parent, explicitly: null, not nothing.
    const u4 = message('u4', 'user', null, { content: 'From the top' });
    const a6 = message('a6', 'assistant', 'u4', { content: '', status: 'streaming', model: modelA.id });
    fetcher.mockResolvedValueOnce(sse([
      { type: 'start', conversation: conversation('a6'), user: u4, assistant: a6, context: { messages: 1, truncated: false, project: false, system: false, tokens: 1, budget: 32000, window: null } },
      { type: 'done', status: 'complete' }
    ]));
    workspace.setThinking(null);
    await workspace.edit(workspace.messages[0], 'From the top');
    expect(sent(1)).toEqual({ conversationId: CHAT, projectId: null, model: modelA.id, text: 'From the top', parentId: null });
    expect(ids(workspace.messages)).toEqual(['u4', 'a6']);
    expect(workspace.active.branch(workspace.messages[0])).toEqual({ index: 1, count: 2 });
    // Nothing is sent for empty words, an answer, or while writing.
    await workspace.edit(workspace.messages[0], '   ');
    await workspace.edit(workspace.messages[1], 'not a question');
    workspace.active.busy = true;
    await workspace.edit(workspace.messages[0], 'while busy');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('refuses to answer again while writing, while a response is stranded, or with a model the server does not list', async () => {
    await workspace.boot();
    await workspace.open(CHAT);
    const shown = workspace.messages[1];
    await workspace.regenerate(shown, 'local:unknown');
    expect(fetcher).not.toHaveBeenCalled();
    expect(workspace.model).toBe(modelA.id);
    workspace.active.busy = true;
    await workspace.regenerate(shown, modelB.id);
    expect(fetcher).not.toHaveBeenCalled();
    workspace.active.busy = false;
    workspace.active.messages[1].status = 'streaming';
    await workspace.regenerate(shown, modelB.id);
    expect(fetcher).not.toHaveBeenCalled();
    workspace.active.messages[1].status = 'complete';
    await workspace.regenerate(shown, modelB.id);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('listens again for what came after the last event heard when the stream drops, and is whole afterwards', async () => {
    await workspace.boot();
    await workspace.open(CHAT);
    workspace.draft = 'Cut off';
    const u3 = message('u3', 'user', 'a1', { content: 'Cut off' });
    const a4 = message('a4', 'assistant', 'u3', { content: '', status: 'streaming' });
    fetcher.mockResolvedValueOnce(sse([
      { type: 'start', conversation: conversation('a4'), user: u3, assistant: a4, context: { messages: 1, truncated: false, project: false, system: false, tokens: 1, budget: 32000, window: null } },
      { type: 'delta', text: 'part', seq: 1 }
    ]));
    // The server still has the response: the rest comes from the second listen.
    fetcher.mockResolvedValueOnce(sse([{ type: 'delta', text: ' and the rest', seq: 2 }, { type: 'done', status: 'complete', seq: 3 }]));
    await workspace.send();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1][0])).toBe(`/api/chat/stream?conversationId=${CHAT}&after=1`);
    expect(workspace.messages[3].status).toBe('complete');
    expect(workspace.messages[3].content).toBe('part and the rest');
    expect(workspace.problem).toBe('');
    expect(workspace.busy).toBe(false);
  });
  it('reads the row again when the server has nothing left to say, and gives up in words when it cannot be reached', async () => {
    await workspace.boot();
    await workspace.open(CHAT);
    workspace.draft = 'Cut off';
    const u3 = message('u3', 'user', 'a1', { content: 'Cut off' });
    const a4 = message('a4', 'assistant', 'u3', { content: '', status: 'streaming' });
    const opening = (): Extract<ChatEvent, { type: 'start' }> => ({ type: 'start', conversation: conversation('a4'), user: u3, assistant: a4, context: { messages: 1, truncated: false, project: false, system: false, tokens: 1, budget: 32000, window: null } });
    fetcher.mockResolvedValueOnce(sse([opening(), { type: 'delta', text: 'part', seq: 1 }]));
    // Nothing being written any more: the row says how it ended.
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'No response is being written for this conversation.' }), { status: 404 }));
    const finished = { ...a4, content: 'part and saved', status: 'complete' as const };
    mocks.api.mockImplementation(async (path: string) => {
      if (path === '/api/bootstrap') return bootstrap();
      if (path === `/api/conversations/${CHAT}`) return { conversation: conversation('a4'), messages: [...tree(), u3, finished] };
      throw new Error(`Unexpected API request: ${path}`);
    });
    await workspace.send();
    expect(workspace.messages[3].status).toBe('complete');
    expect(workspace.messages[3].content).toBe('part and saved');
    expect(workspace.problem).toBe('');
    // Four tries and no answer: the turn is marked, and the sentence says the server goes on.
    workspace.draft = 'Cut off again';
    const a5 = message('a5', 'assistant', 'u3', { content: '', status: 'streaming' });
    fetcher.mockResolvedValueOnce(sse([{ ...opening(), assistant: a5 }, { type: 'delta', text: 'half', seq: 1 }]));
    fetcher.mockRejectedValue(new Error('offline'));
    await workspace.send();
    const half = workspace.active.messages.find(m => m.id === 'a5')!;
    expect(half.status).toBe('interrupted');
    expect(half.content).toBe('half');
    expect(workspace.problem).toContain('goes on being written');
  }, 20_000);
  it('follows a response another tab or device is still writing when the conversation opens, from a snapshot', async () => {
    const u3 = message('u3', 'user', 'a1', { content: 'Elsewhere' });
    const a4 = message('a4', 'assistant', 'u3', { content: 'checkpointed', status: 'streaming' });
    mocks.api.mockImplementation(async (path: string) => {
      if (path === '/api/bootstrap') return bootstrap();
      if (path === `/api/conversations/${CHAT}`) return { conversation: conversation('a4'), messages: [...tree(), u3, a4] };
      throw new Error(`Unexpected API request: ${path}`);
    });
    fetcher.mockResolvedValueOnce(sse([
      { type: 'snapshot', content: 'checkpointed and more', thinking: null, thinking_ms: null, seq: 5, elapsed_ms: 3000 },
      { type: 'delta', text: ', then the end', seq: 6 },
      { type: 'done', status: 'complete', seq: 7 }
    ]));
    await workspace.boot();
    await workspace.open(CHAT);
    expect(String(fetcher.mock.calls[0][0])).toBe(`/api/chat/stream?conversationId=${CHAT}`);
    await vi.waitFor(() => expect(workspace.messages[3].status).toBe('complete'));
    expect(workspace.messages[3].content).toBe('checkpointed and more, then the end');
    expect(workspace.busy).toBe(false);
  });
});
