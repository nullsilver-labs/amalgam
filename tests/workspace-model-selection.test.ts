import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bootstrap, Conversation, Message, ModelOption } from '../src/lib/types';
import { DEFAULT_SETTINGS } from '../src/lib/types';

const mocks = vi.hoisted(() => ({ api: vi.fn(), replaceState: vi.fn() }));
vi.mock('../src/lib/api', () => ({ api: mocks.api }));
vi.mock('$app/navigation', () => ({ replaceState: mocks.replaceState }));

const modelA: ModelOption = { id: 'manual:a', name: 'a', provider: 'Manual', destination: 'a.test', window: 8000, kind: 'openai' };
const modelB: ModelOption = { id: 'discovered:b', name: 'b', provider: 'Discovered', destination: 'b.test', window: null, kind: 'openai' };
const conversation = (id: string): Conversation => ({ id, title: id, project_id: null, created_at: '', updated_at: '', leaf_id: null });
const history = (id: string, model: string | null) => ({
  conversation: conversation(id), messages: model ? [{
    id: 'message', conversation_id: id, role: 'assistant', content: 'Saved reply', status: 'complete',
    model, sources: null, error: null, created_at: '', parent_id: null, thinking: null, thinking_ms: null,
    input_tokens: null, output_tokens: null, tokens_estimated: null, first_token_ms: null, duration_ms: null
  } satisfies Message] : []
});
function bootstrap(models: ModelOption[], failed = false): Bootstrap {
  return {
    conversations: [conversation('chat-b'), conversation('chat-a')], projects: [], models,
    modelConnections: [
      { id: 'manual', name: 'Manual', destination: 'a.test', state: 'explicit', detail: 'Manual list.', checkedAt: null },
      { id: 'discovered', name: 'Discovered', destination: 'b.test', state: failed ? 'error' : 'discovered',
        detail: failed ? 'Could not read the model list.' : 'Catalog refreshed.', checkedAt: '2026-01-01T00:00:00Z' }
    ],
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

let workspace: typeof import('../src/lib/state/workspace.svelte').workspace;
let prefs: typeof import('../src/lib/state/prefs.svelte').prefs;
let Composer: typeof import('../src/lib/components/Composer.svelte').default;
let render: typeof import('svelte/server').render;
let current: Bootstrap;
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
  current = bootstrap([modelA, modelB]);
  mocks.api.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/bootstrap') return structuredClone(current);
    if (path === '/api/conversations/chat-b') return init?.method === 'PATCH' ? conversation('chat-b') : history('chat-b', modelB.id);
    if (path === '/api/conversations/chat-a') return history('chat-a', modelA.id);
    throw new Error(`Unexpected API request: ${path}`);
  });
  ({ workspace } = await import('../src/lib/state/workspace.svelte'));
  ({ prefs } = await import('../src/lib/state/prefs.svelte'));
  ({ default: Composer } = await import('../src/lib/components/Composer.svelte'));
  ({ render } = await import('svelte/server'));
}, 60_000);
afterEach(() => vi.unstubAllGlobals());

function expectUnavailable() {
  expect(workspace.model).toBe(modelB.id);
  expect(workspace.selectedModel).toBeNull();
  expect(workspace.modelUnavailable).toBe(true);
  expect(workspace.canSend).toBe(false);
  expect(workspace.canSendFrom(workspace.active)).toBe(false);
  // Render the actual composer/picker against the state, not duplicated UI logic.
  const html = render(Composer).body;
  expect(html).toContain('discovered:b (unavailable)');
  expect(html).toContain('Selected model “discovered:b” is unavailable. Sending is disabled.');
  expect(html).toContain('check Settings → Models and reload');
  expect(html.match(/<button[^>]*aria-label="Send message"[^>]*>/)?.[0]).toContain('disabled');
  expect(html).not.toContain('a.test');
  if (workspace.data.models.length) {
    expect(html.match(/<button[^>]*aria-label="Model"[^>]*>/)?.[0]).not.toContain('disabled');
  }
}
function expectAvailable(model: ModelOption) {
  expect(workspace.model).toBe(model.id);
  expect(workspace.selectedModel?.destination).toBe(model.destination);
  expect(workspace.modelUnavailable).toBe(false);
  expect(workspace.canSend).toBe(true);
  const html = render(Composer).body;
  expect(html).not.toContain('Sending is disabled.');
  expect(html.match(/<button[^>]*aria-label="Send message"[^>]*>/)?.[0]).not.toContain('disabled');
}

describe('workspace model selection safety', () => {
  it('retains a saved selection on cold-cache discovery failure, blocks all send paths, and recovers the same ID', async () => {
    localStorage.setItem('amalgam:prefs', JSON.stringify({ model: modelB.id }));
    current = bootstrap([modelA], true); // provider B has no last-success cache after a server restart
    await workspace.boot();
    workspace.draft = 'Do not send this to provider A';
    expectUnavailable();
    expect(prefs.model).toBe(modelB.id);
    await workspace.send(); // used by both submit and the keyboard shortcut
    await workspace.active.send();
    expect(fetcher).not.toHaveBeenCalled();
    expect(workspace.draft).toBe('Do not send this to provider A');

    current = bootstrap([modelA, modelB]);
    await workspace.refresh();
    expectAvailable(modelB);
    expect(prefs.model).toBe(modelB.id);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('retains a successfully removed model during rename refresh until explicit replacement, including conversation reload', async () => {
    await workspace.boot();
    await workspace.open('chat-b');
    workspace.draft = 'Keep my destination';
    current = bootstrap([modelA]); // successful catalog refresh removed B; A is still healthy
    await workspace.rename('chat-b', 'Renamed');
    expectUnavailable();
    await workspace.send();
    expect(fetcher).not.toHaveBeenCalled();

    workspace.chooseModel(modelA.id);
    expectAvailable(modelA);
    expect(prefs.model).toBe(modelA.id);
    await workspace.reload(); // history still names B: do not undo the person's replacement
    expectAvailable(modelA);
    fetcher.mockResolvedValueOnce(Response.json({ message: 'Mock refusal; no generation performed' }, { status: 400 }));
    await workspace.send();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).model).toBe(modelA.id);
  });

  it.each(['open', 'openTab'] as const)('restores an unavailable historical model when changing conversations through %s, not an inherited provider', async method => {
    current = bootstrap([modelA], true);
    await workspace.boot();
    expect(workspace.model).toBe(modelA.id);
    await workspace[method]('chat-b');
    workspace.draft = 'Original provider only';
    expectUnavailable();
    await workspace.send();
    expect(fetcher).not.toHaveBeenCalled();
    await workspace.open('chat-a');
    workspace.draft = 'This conversation belongs to A';
    expectAvailable(modelA);
    await workspace.open('chat-b');
    workspace.draft = 'Still B';
    expectUnavailable();
  });

  it('keeps unavailable choices in inactive, new and replacement blank tabs', async () => {
    await workspace.boot();
    await workspace.open('chat-b');
    const original = workspace.active;
    await workspace.newTab();
    const blank = workspace.active;
    expect(blank.model).toBe(modelB.id);
    current = bootstrap([modelA]);
    await workspace.refresh();
    expect(original.model).toBe(modelB.id);
    expect(blank.model).toBe(modelB.id);
    workspace.draft = 'Blank tab';
    expectUnavailable();
    await workspace.activate(original.key);
    workspace.draft = 'Original tab';
    expectUnavailable();
    workspace.closeTab(blank.key);
    workspace.closeTab(original.key); // closing the last conversation leaves a blank tab
    workspace.draft = 'Replacement blank tab';
    expectUnavailable();
    await workspace.send();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('persists per-tab unavailable selections and restores them instead of global preferences or older history', async () => {
    current = bootstrap([modelA], true);
    localStorage.setItem('amalgam:prefs', JSON.stringify({ model: modelA.id }));
    sessionStorage.setItem('amalgam:tabs', JSON.stringify({
      tabs: [
        { id: 'chat-a', project: null, model: modelB.id }, // explicit choice made after the last A response
        { id: null, project: null, model: modelB.id }
      ], active: 0
    }));
    await workspace.boot();
    workspace.draft = 'Keep this tab choice';
    expectUnavailable();
    workspace.persistTabs();
    expect(JSON.parse(sessionStorage.getItem('amalgam:tabs')!).tabs.map((tab: { model: string }) => tab.model)).toEqual([modelB.id, modelB.id]);
    await workspace.activate(workspace.sessions[1].key);
    workspace.draft = 'Keep blank tab choice';
    expectUnavailable();
    workspace.chooseModel(modelA.id);
    workspace.persistTabs();
    expect(JSON.parse(sessionStorage.getItem('amalgam:tabs')!).tabs.map((tab: { model: string }) => tab.model)).toEqual([modelB.id, modelA.id]);
    await workspace.activate(workspace.sessions[0].key);
    expectUnavailable();
  });

  it('restores legacy tabs from exact history without persisting an inherited default for an unopened chat', async () => {
    current = bootstrap([modelA], true);
    sessionStorage.setItem('amalgam:tabs', JSON.stringify({
      tabs: [{ id: null, project: null }, { id: 'chat-b', project: null }], active: 0
    }));
    await workspace.boot();
    workspace.persistTabs();
    expect(JSON.parse(sessionStorage.getItem('amalgam:tabs')!).tabs[1]).not.toHaveProperty('model');
    await workspace.activate(workspace.sessions[1].key);
    workspace.draft = 'Original model from history';
    expectUnavailable();
    workspace.persistTabs();
    expect(JSON.parse(sessionStorage.getItem('amalgam:tabs')!).tabs[1].model).toBe(modelB.id);
  });

  it('does not replace an unavailable model when the entire catalog is empty and does not accept invalid replacement IDs', async () => {
    await workspace.boot();
    workspace.chooseModel(modelB.id);
    current = bootstrap([], true);
    await workspace.refresh();
    workspace.draft = 'Wait for the original';
    expectUnavailable();
    workspace.chooseModel('');
    workspace.chooseModel(modelA.id);
    expect(workspace.model).toBe(modelB.id);
    expect(prefs.model).toBe(modelB.id);
    await workspace.send();
    expect(fetcher).not.toHaveBeenCalled();
    current = bootstrap([modelB, modelA]);
    await workspace.refresh();
    expectAvailable(modelB);
  });

  it('does not replace an existing unavailable selection with global preferences when boot runs again', async () => {
    await workspace.boot();
    workspace.chooseModel(modelB.id);
    prefs.setModel(modelA.id); // another context's default is not this tab's selection
    current = bootstrap([modelA], true);
    await workspace.boot();
    workspace.draft = 'Keep the existing selection';
    expectUnavailable();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('defaults only when no selection exists and never reorders an established choice', async () => {
    current = bootstrap([]);
    await workspace.boot();
    workspace.draft = 'Initial default';
    expect(workspace.model).toBe('');
    expect(workspace.canSend).toBe(false);
    current = bootstrap([modelA, modelB]);
    await workspace.refresh();
    expectAvailable(modelA);
    current = bootstrap([modelB, modelA]);
    await workspace.refresh();
    expectAvailable(modelA);
  });
});
