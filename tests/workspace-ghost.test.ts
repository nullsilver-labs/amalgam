import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bootstrap, ChatEvent, Conversation, Message, ModelOption } from '../src/lib/types';
import { DEFAULT_SETTINGS } from '../src/lib/types';

/*
 * A ghost chat is written nowhere. These pin what that means in the tab
 * that holds one: every message carries the chat, nothing reaches the
 * archive, the URL, or this browser's storage, and the tree of answers is
 * the tab's own — linked from what the server hands back with no links.
 */

const mocks = vi.hoisted(() => ({ api: vi.fn(), replaceState: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: mocks.api }));
vi.mock('$app/navigation', () => ({ replaceState: mocks.replaceState }));

const modelA: ModelOption = { id: 'local:a', name: 'a', provider: 'Local', destination: 'a.test', window: 8000 };
const modelB: ModelOption = { id: 'local:b', name: 'b', provider: 'Local', destination: 'b.test', window: null };
const GHOST = '33333333-3333-4333-8333-333333333333';
const SAVED = 'chat-saved';
const saved: Conversation = { id: SAVED, title: 'Kept', project_id: null, created_at: '', updated_at: '', leaf_id: 's2' };
function bootstrap(): Bootstrap {
  return {
    conversations: [saved], projects: [], models: [modelA, modelB],
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
/** What the server hands a ghost: fresh ids, no links, the chat named after the text. */
function ghostStart(id: string, text: string, model = modelA.id): Extract<ChatEvent, { type: 'start' }> {
  const now = '2026-09-07T12:00:00.000Z';
  const user: Message = { id: `u-${id}`, conversation_id: GHOST, role: 'user', content: text, status: 'complete', model: null, error: null, created_at: now, sources: null, parent_id: null, thinking: null, thinking_ms: null };
  const assistant: Message = { id: `a-${id}`, conversation_id: GHOST, role: 'assistant', content: '', status: 'streaming', model, error: null, created_at: now, sources: null, parent_id: user.id, thinking: null, thinking_ms: null };
  return {
    type: 'start', user, assistant,
    conversation: { id: GHOST, title: text.slice(0, 80), project_id: null, created_at: now, updated_at: now, leaf_id: assistant.id },
    context: { messages: 1, truncated: false, project: false, system: false, tokens: 1, budget: 32000, window: 8000 }
  };
}
function sse(events: ChatEvent[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(sink) { for (const event of events) sink.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); sink.close(); }
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}
const answer = (start: ChatEvent, text: string): ChatEvent[] => [start, { type: 'delta', text }, { type: 'done', status: 'complete' }];
const sent = (call: number) => JSON.parse(String(fetcher.mock.calls[call][1]?.body));
const ids = (list: Message[]) => list.map(m => m.id);
const stored = () => JSON.stringify(Object.fromEntries([...Array(sessionStorage.length).keys()].map(i => { const k = sessionStorage.key(i)!; return [k, sessionStorage.getItem(k)]; })));

let store: typeof import('../src/lib/state/workspace.svelte');
let workspace: typeof store.workspace;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(async () => {
  vi.resetModules();
  mocks.api.mockReset();
  mocks.replaceState.mockReset();
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('sessionStorage', storage());
  vi.stubGlobal('location', new URL('https://app.test/'));
  fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('Unexpected generation request'));
  vi.stubGlobal('fetch', fetcher);
  mocks.api.mockImplementation(async (path: string) => {
    if (path === '/api/bootstrap') return bootstrap();
    if (path === `/api/conversations/${SAVED}`) {
      const s1: Message = { id: 's1', conversation_id: SAVED, role: 'user', content: 'kept?', status: 'complete', model: null, error: null, created_at: '', sources: null, parent_id: null, thinking: null, thinking_ms: null };
      const s2: Message = { ...s1, id: 's2', role: 'assistant', content: 'kept.', model: modelA.id, parent_id: 's1' };
      return { conversation: saved, messages: [s1, s2] };
    }
    throw new Error(`Unexpected API request: ${path}`);
  });
  store = await import('../src/lib/state/workspace.svelte');
  workspace = store.workspace;
  await workspace.boot();
}, 60_000);
afterEach(() => { vi.unstubAllGlobals(); });

describe('becoming a ghost', () => {
  it('is a blank tab\'s choice, and takes the draft out of storage with it', () => {
    expect(workspace.canToggleGhost).toBe(true);
    workspace.draft = 'typed before'; workspace.rememberDraft();
    expect(stored()).toContain('typed before');
    workspace.toggleGhost();
    expect(workspace.ghost).toBe(true);
    expect(workspace.draft).toBe('typed before');
    expect(stored()).not.toContain('typed before');
    // Typing on does not put it back.
    workspace.draft = 'typed after'; workspace.rememberDraft();
    expect(stored()).not.toContain('typed after');
    // Off again, and the draft is remembered as any draft is.
    workspace.toggleGhost();
    expect(workspace.ghost).toBe(false);
    expect(stored()).toContain('typed after');
  });
  it('is settled by the first message: a chat with anything in it cannot change', async () => {
    workspace.toggleGhost();
    workspace.draft = 'first';
    fetcher.mockResolvedValueOnce(sse(answer(ghostStart('1', 'first'), 'ok')));
    await workspace.send();
    expect(workspace.canToggleGhost).toBe(false);
    workspace.toggleGhost();
    expect(workspace.ghost).toBe(true);
  });
  it('is not what a saved conversation opened into the tab is', async () => {
    workspace.toggleGhost();
    await workspace.open(SAVED);
    expect(workspace.ghost).toBe(false);
    expect(workspace.current?.id).toBe(SAVED);
  });
});

describe('a ghost chat', () => {
  it('sends the whole chat with every message, and shows up nowhere else', async () => {
    workspace.toggleGhost();
    workspace.draft = 'first';
    fetcher.mockResolvedValueOnce(sse(answer(ghostStart('1', 'first'), 'one')));
    await workspace.send();
    expect(sent(0)).toEqual({ ghost: true, projectId: null, model: modelA.id, text: 'first', history: [] });
    expect(workspace.current?.id).toBe(GHOST);
    expect(workspace.current?.title).toBe('first');
    expect(ids(workspace.messages)).toEqual(['u-1', 'a-1']);
    expect(workspace.messages[0].parent_id).toBeNull();
    expect(workspace.messages[1].parent_id).toBe('u-1');
    expect(workspace.messages[1].content).toBe('one');
    expect(workspace.draft).toBe('');

    workspace.draft = 'second';
    fetcher.mockResolvedValueOnce(sse(answer(ghostStart('2', 'second'), 'two')));
    await workspace.send();
    expect(sent(1)).toEqual({
      ghost: true, conversationId: GHOST, projectId: null, model: modelA.id, text: 'second',
      history: [{ role: 'user', content: 'first', status: 'complete' }, { role: 'assistant', content: 'one', status: 'complete' }]
    });
    expect(ids(workspace.messages)).toEqual(['u-1', 'a-1', 'u-2', 'a-2']);
    expect(workspace.messages[2].parent_id).toBe('a-1');
    // The name is the first message's, for as long as the chat lasts.
    expect(workspace.current?.title).toBe('first');
    expect(workspace.current?.leaf_id).toBe('a-2');

    // Not in the archive, not in the address, not in storage, and never asked of the server.
    expect(workspace.data.conversations.map(c => c.id)).toEqual([SAVED]);
    expect(mocks.replaceState.mock.calls.every(([url]) => url === '/')).toBe(true);
    workspace.persistTabs();
    expect(stored()).not.toContain('first');
    expect(stored()).not.toContain(GHOST);
    expect(JSON.parse(sessionStorage.getItem('amalgam:tabs')!).tabs).toEqual([{ id: null, project: null, model: modelA.id, ghost: true }]);
    expect(mocks.api.mock.calls.some(([path]) => String(path).startsWith('/api/conversations'))).toBe(false);
  });
  it('answers a message again beside the first answer, from the turns before it, and switches branches by itself', async () => {
    workspace.toggleGhost();
    workspace.draft = 'first';
    fetcher.mockResolvedValueOnce(sse(answer(ghostStart('1', 'first'), 'one')));
    await workspace.send();
    workspace.draft = 'second';
    fetcher.mockResolvedValueOnce(sse(answer(ghostStart('2', 'second'), 'two')));
    await workspace.send();

    fetcher.mockResolvedValueOnce(sse(answer(ghostStart('3', 'second', modelB.id), 'two again')));
    workspace.draft = 'kept';
    await workspace.regenerate(workspace.messages[3], modelB.id);
    expect(sent(2)).toEqual({
      ghost: true, conversationId: GHOST, projectId: null, model: modelB.id, text: 'second',
      history: [{ role: 'user', content: 'first', status: 'complete' }, { role: 'assistant', content: 'one', status: 'complete' }]
    });
    expect(workspace.draft).toBe('kept');
    expect(workspace.active.messages).toHaveLength(5);
    expect(ids(workspace.messages)).toEqual(['u-1', 'a-1', 'u-2', 'a-3']);
    expect(workspace.messages[3].parent_id).toBe('u-2');
    expect(workspace.messages[3].content).toBe('two again');
    expect(workspace.active.branch(workspace.messages[3])).toEqual({ index: 1, count: 2 });

    const before = mocks.api.mock.calls.length;
    await workspace.switchBranch(workspace.messages[3], -1);
    expect(ids(workspace.messages)).toEqual(['u-1', 'a-1', 'u-2', 'a-2']);
    expect(workspace.current?.leaf_id).toBe('a-2');
    expect(mocks.api.mock.calls.length).toBe(before);
  });
  it('keeps its place when a saved conversation is opened, is renamed and forgotten in the tab alone, and closes for good', async () => {
    workspace.toggleGhost();
    workspace.draft = 'first';
    fetcher.mockResolvedValueOnce(sse(answer(ghostStart('1', 'first'), 'one')));
    await workspace.send();
    const ghostKey = workspace.activeKey;

    await workspace.open(SAVED);
    expect(workspace.sessions).toHaveLength(2);
    expect(workspace.current?.id).toBe(SAVED);
    expect(workspace.sessions.find(s => s.key === ghostKey)?.conversation?.id).toBe(GHOST);

    await workspace.rename(GHOST, 'Named');
    expect(workspace.sessions.find(s => s.key === ghostKey)?.title).toBe('Named');
    await workspace.remove(GHOST);
    const tab = workspace.sessions.find(s => s.key === ghostKey)!;
    expect(tab.conversation).toBeNull();
    expect(tab.messages).toEqual([]);
    expect(tab.ghost).toBe(true);
    expect(mocks.api.mock.calls.some(([path]) => String(path).includes(GHOST))).toBe(false);

    workspace.closeTab(ghostKey);
    expect(workspace.sessions).toHaveLength(1);
    expect(workspace.current?.id).toBe(SAVED);
  });
  it('comes back from a reload as the blank ghost tab it began as', async () => {
    workspace.toggleGhost();
    workspace.draft = 'first';
    fetcher.mockResolvedValueOnce(sse(answer(ghostStart('1', 'first'), 'one')));
    await workspace.send();
    workspace.persistTabs();
    vi.resetModules();
    const again = (await import('../src/lib/state/workspace.svelte')).workspace;
    await again.boot();
    expect(again.sessions).toHaveLength(1);
    expect(again.ghost).toBe(true);
    expect(again.current).toBeNull();
    expect(again.messages).toEqual([]);
    // A lone ghost tab can be closed: what is left is an ordinary blank tab.
    again.closeTab(again.activeKey);
    expect(again.sessions).toHaveLength(1);
    expect(again.ghost).toBe(false);
  });
});
