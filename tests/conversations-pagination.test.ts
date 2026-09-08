import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bootstrap, Conversation } from '../src/lib/types';
import { DEFAULT_SETTINGS } from '../src/lib/types';

/*
 * The archive is longer than one page. These pin how the next page is asked
 * for and joined: from where the list ends rather than from an offset, with
 * anything already in hand kept once, and one page in flight at a time.
 */

const mocks = vi.hoisted(() => ({ api: vi.fn(), replaceState: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: mocks.api }));
vi.mock('$app/navigation', () => ({ replaceState: mocks.replaceState }));

const PAGE = 200;

/** A conversation whose place in the list is its number: newest first. */
function conversation(n: number): Conversation {
  const at = new Date(Date.UTC(2026, 0, 1) - n * 60_000).toISOString();
  return { id: `c-${n}`, title: `Chat ${n}`, project_id: null, created_at: at, updated_at: at, leaf_id: null };
}
const page = (from: number, count: number) => Array.from({ length: count }, (_, i) => conversation(from + i));

function bootstrap(conversations: Conversation[]): Bootstrap {
  return {
    conversations, projects: [], models: [],
    modelConnections: [],
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

let store: typeof import('../src/lib/state/workspace.svelte');
let workspace: typeof store.workspace;
/** The conversations the next `/api/conversations?before=…` will answer with. */
let older: Conversation[];
/** Held open, when a test wants a page still in flight. */
let release: (() => void) | null;

async function start(first: Conversation[]) {
  mocks.api.mockImplementation(async (path: string) => {
    if (path === '/api/bootstrap') return bootstrap(first);
    if (path.startsWith('/api/conversations?before=')) {
      if (release) await new Promise<void>(resolve => { release = resolve; });
      return older;
    }
    throw new Error(`Unexpected API request: ${path}`);
  });
  store = await import('../src/lib/state/workspace.svelte');
  workspace = store.workspace;
  await workspace.boot();
}

const asked = () => mocks.api.mock.calls.map(([path]) => String(path)).filter(p => p.startsWith('/api/conversations?before='));

beforeEach(() => {
  vi.resetModules();
  mocks.api.mockReset();
  mocks.replaceState.mockReset();
  older = [];
  release = null;
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('sessionStorage', storage());
  vi.stubGlobal('location', new URL('https://app.test/'));
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('Unexpected request')));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('older conversations', () => {
  it('asks from where the list ends, appends the page, and keeps anything already held once', async () => {
    await start(page(0, PAGE));
    expect(workspace.moreConversations).toBe(true);
    const last = workspace.data.conversations[PAGE - 1];

    // The page overlaps the list by one row: that row must not arrive twice.
    older = [last, ...page(PAGE, PAGE - 1)];
    await workspace.loadOlderConversations();

    expect(asked()).toEqual([`/api/conversations?before=${encodeURIComponent(last.updated_at)}&beforeId=${encodeURIComponent(last.id)}`]);
    expect(workspace.data.conversations).toHaveLength(PAGE * 2 - 1);
    expect(workspace.data.conversations.filter(c => c.id === last.id)).toHaveLength(1);
    expect(workspace.data.conversations[PAGE].id).toBe('c-200');
    expect(workspace.loadingOlder).toBe(false);
    // A full page: there may be more behind it.
    expect(workspace.moreConversations).toBe(true);
  });

  it('reaches the end on a short page, and stops asking', async () => {
    await start(page(0, PAGE));
    older = page(PAGE, 3);
    await workspace.loadOlderConversations();
    expect(workspace.data.conversations).toHaveLength(PAGE + 3);
    expect(workspace.moreConversations).toBe(false);

    await workspace.loadOlderConversations();
    expect(asked()).toHaveLength(1);
  });

  it('holds nothing more to show when the first page was short', async () => {
    await start(page(0, 12));
    expect(workspace.moreConversations).toBe(false);
    await workspace.loadOlderConversations();
    expect(asked()).toHaveLength(0);
  });

  it('runs one page at a time: a second call while one is in flight is nothing', async () => {
    await start(page(0, PAGE));
    older = page(PAGE, PAGE);
    release = () => {};
    const first = workspace.loadOlderConversations();
    await Promise.resolve();
    expect(workspace.loadingOlder).toBe(true);
    await workspace.loadOlderConversations();
    expect(asked()).toHaveLength(1);
    release?.();
    await first;
    expect(workspace.data.conversations).toHaveLength(PAGE * 2);
    expect(workspace.loadingOlder).toBe(false);
  });

  it('says what went wrong and lets the page be asked for again', async () => {
    await start(page(0, PAGE));
    mocks.api.mockRejectedValueOnce(new Error('The archive is unavailable.'));
    await workspace.loadOlderConversations();
    expect(workspace.problem).toBe('The archive is unavailable.');
    expect(workspace.loadingOlder).toBe(false);
    expect(workspace.data.conversations).toHaveLength(PAGE);

    older = page(PAGE, 2);
    await workspace.loadOlderConversations();
    expect(workspace.data.conversations).toHaveLength(PAGE + 2);
  });
});
