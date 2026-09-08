/*
 * The workspace — everything the interface knows about this instance, the
 * conversations open in its tabs, and the actions that change them.
 * Components read fields and call methods; nothing else talks to the API.
 *
 * A Session is one open tab: a conversation (or a blank one), its messages,
 * its draft, and the response it may be writing. The workspace holds the
 * sessions and forwards the active one's fields under the names components
 * have always read — `workspace.messages` is the active tab's messages.
 *
 * A tab may be a ghost chat: one that is written nowhere — not the database,
 * not this browser's storage. It lives in the tab that holds it and is gone
 * when that tab closes or the page reloads; every message sends the whole
 * chat, since the server keeps none of it. A blank tab can become one, and
 * a ghost is a ghost from its first message on.
 *
 * A saved response, once started, is the server's to finish: the tab only
 * listens. Lose the connection and it listens again from the last event it
 * heard; open a conversation whose response is still being written — after
 * a reload, in another tab — and it listens from a snapshot of what has been
 * said. Stopping is a request to the server, never the closing of a tab.
 *
 * Client-only: `boot()` runs from the page's onMount, and every method
 * assumes a browser (fetch, sessionStorage, the router).
 */

import { replaceState } from '$app/navigation';
import { api } from '$lib/api';
import { eventData } from '$lib/sse';
import { copyText } from '$lib/clipboard';
import { DEFAULT_SETTINGS, GHOST_HISTORY_TURNS, type Bootstrap, type ChatEvent, type ChatSettings, type ContextInfo, type Conversation, type CorpusDiagnostic, type CorpusSearchResult, type DeviceSession, type HistoryTurn, type IntegrationToken, type Message, type Project, type Scope, type SelectedSource, type UsageSummary } from '$lib/types';
import { prefs } from './prefs.svelte';

const EMPTY: Bootstrap = {
  conversations: [], projects: [], models: [], modelConnections: [],
  integrations: { corpus: { configured: false, publicUrl: '' }, embeddings: false },
  settings: DEFAULT_SETTINGS
};

/** Open tabs survive a reload of this browser tab, like drafts do. A ghost tab survives as a blank one. */
const TABS_KEY = 'amalgam:tabs';
const MAX_TABS = 20;
/** How many conversations one page of the archive holds, as the server sends them. */
const CONVERSATION_PAGE = 200;

/** What a ghost request carries of the turns before it: the newest, as far back as the server reads. */
export function historyOf(thread: Message[]): HistoryTurn[] {
  return thread.slice(-GHOST_HISTORY_TURNS).map(m => ({ role: m.role, content: m.content, status: m.status }));
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'The connection failed. Try again.';
}

let sequence = 0;

/** A conversation as a tab knows it before its messages have been fetched. */
function stub(id: string, title: string, project_id: string | null): Conversation {
  return { id, title, project_id, created_at: '', updated_at: '', leaf_id: null };
}

/**
 * The branch that ends at `leafId`: root first. A conversation is a tree —
 * an answer generated again sits beside the first, under the same message —
 * and the transcript shows one path through it. A leaf nobody can find (a
 * conversation from before branching, say) means the newest message.
 */
export function threadOf(messages: Message[], leafId: string | null): Message[] {
  if (!messages.length) return [];
  const byId = new Map(messages.map(m => [m.id, m]));
  const out: Message[] = [];
  const seen = new Set<string>();
  let node: Message | undefined = (leafId && byId.get(leafId)) || messages[messages.length - 1];
  while (node && !seen.has(node.id)) {
    seen.add(node.id); out.push(node);
    node = node.parent_id ? byId.get(node.parent_id) : undefined;
  }
  return out.reverse();
}

/** The messages that follow the same one as `message` — itself among them, in the order written. */
export function siblingsOf(messages: Message[], message: Message): Message[] {
  const parent = message.parent_id ?? null;
  return messages.filter(m => (m.parent_id ?? null) === parent);
}

/** The newest end of the branch below `message`: itself, or its latest child's latest child, and so on. */
export function tipOf(messages: Message[], message: Message): Message {
  let node = message;
  for (let guard = 0; guard < messages.length; guard++) {
    const children = messages.filter(m => m.parent_id === node.id);
    if (!children.length) return node;
    node = children[children.length - 1];
  }
  return node;
}

export class Session {
  /** Tab identity — stable while a blank tab becomes a saved conversation. */
  readonly key = `tab-${++sequence}`;
  conversation = $state<Conversation | null>(null);
  /** Every message of the conversation, every branch, in the order written. */
  messages = $state<Message[]>([]);
  /** The end of the branch being read. */
  leafId = $state<string | null>(null);
  projectId = $state<string | null>(null);
  model = $state('');
  draft = $state('');
  /** corpus cards this tab will quote with its next message. Held per tab, like the draft. */
  sources = $state<SelectedSource[]>([]);
  problem = $state('');
  contextInfo = $state<ContextInfo | null>(null);
  loading = $state(false);
  busy = $state(false);
  /** Whether the tab has shown its content once: a restored tab loads when first activated. */
  loaded = $state(false);
  /** Bumped whenever the composer should take focus. */
  focusTick = $state(0);
  /** When the response this tab is writing was accepted — what "Thinking for 12s" counts from. */
  startedAt = $state(0);
  /** A ghost chat: held in this tab alone, written nowhere, gone when the tab closes or the page reloads. */
  ghost = $state(false);
  /** Whether replies in this tab are asked to think first: chosen here, or null for the instance's setting. */
  thinking = $state<boolean | null>(null);

  /** The branch being read, root first: what the transcript shows and a new message follows. */
  thread = $derived(threadOf(this.messages, this.leafId));
  /** A response is being written — by this tab or, after a reload, by nobody. */
  streaming = $derived(this.messages.some(m => m.status === 'streaming'));
  title = $derived(this.conversation?.title ?? 'New chat');
  /** Nothing in it yet: no conversation, no messages, nothing on its way. */
  fresh = $derived(!this.conversation && !this.messages.length && !this.busy && !this.loading);

  #requestVersion = 0;
  #generation: AbortController | undefined;
  // An inherited new-tab default is not a selection for an unopened chat.
  // Once restored or chosen for that chat, keep it even when unavailable.
  #modelConversationId: string | null = null;

  constructor(model = '') { this.model = model; }

  selectModel(id: string) {
    this.model = id;
    this.#modelConversationId = this.conversation?.id ?? null;
  }

  /** Do not persist an inherited default as an unopened conversation's choice. */
  get rememberedModel() {
    return this.conversation && this.#modelConversationId !== this.conversation.id ? undefined : this.model;
  }

  #scope() { return this.conversation?.id || this.projectId || 'new'; }
  #draftKey() { return `amalgam:draft:${this.#scope()}`; }
  #sourcesKey() { return `amalgam:sources:${this.#scope()}`; }
  /* A ghost tab's draft stays in memory with the rest of it: nothing below touches storage for one. */
  rememberDraft() {
    if (this.ghost) return;
    try {
      sessionStorage.setItem(this.#draftKey(), this.draft);
      sessionStorage.setItem(this.#sourcesKey(), JSON.stringify($state.snapshot(this.sources)));
    } catch { /* storage may be disabled */ }
  }
  /** Take what was typed here out of storage — it goes on with the tab as it becomes a ghost. */
  forgetDraft() {
    try { sessionStorage.removeItem(this.#draftKey()); sessionStorage.removeItem(this.#sourcesKey()); } catch { /* storage may be disabled */ }
  }
  restoreDraft() {
    if (this.ghost) return;
    try { this.draft = sessionStorage.getItem(this.#draftKey()) || ''; } catch { this.draft = ''; }
    try {
      const stored = JSON.parse(sessionStorage.getItem(this.#sourcesKey()) || '[]');
      this.sources = Array.isArray(stored) ? stored.filter(s => s && typeof s.id === 'string').slice(0, 5) : [];
    } catch { this.sources = []; }
  }
  /** Add a card to this tab's next message, or take it off again. */
  toggleSource(source: SelectedSource) {
    this.sources = this.sources.some(s => s.id === source.id)
      ? this.sources.filter(s => s.id !== source.id)
      : [...this.sources, source].slice(0, 5);
    this.rememberDraft();
  }
  removeSource(id: string) { this.sources = this.sources.filter(s => s.id !== id); this.rememberDraft(); }
  focus() { this.focusTick++; }
  abort() { this.#generation?.abort(); }

  /** Fetch a conversation into this tab. Resolves false if it failed or was superseded. */
  async load(id: string): Promise<boolean> {
    const version = ++this.#requestVersion;
    if (this.loaded) this.rememberDraft();
    this.loading = true; this.problem = '';
    try {
      const result = await api<{ conversation: Conversation; messages: Message[] }>(`/api/conversations/${id}`);
      if (version !== this.#requestVersion) return false;
      this.ghost = false;
      this.conversation = result.conversation; this.messages = result.messages; this.projectId = this.conversation.project_id;
      this.leafId = result.conversation.leaf_id ?? null;
      this.contextInfo = null; this.loaded = true; this.restoreDraft();
      if (this.#modelConversationId !== id) {
        const lastModel = [...this.messages].reverse().find(m => m.model)?.model;
        this.selectModel(lastModel || this.model);
      }
      // A response still being written is listened to, not left to a banner.
      if (this.streaming) void this.attach();
      return true;
    } catch (err) { if (version === this.#requestVersion) this.problem = messageOf(err); return false; }
    finally { if (version === this.#requestVersion) this.loading = false; }
  }

  /** A blank conversation, optionally scoped to a project. A ghost tab stays a ghost: that was chosen, and a scope does not unchoose it. */
  blank(scope: string | null) {
    ++this.#requestVersion;
    if (this.loaded) this.rememberDraft();
    this.loading = false; this.conversation = null; this.messages = []; this.leafId = null; this.projectId = scope;
    this.contextInfo = null; this.problem = ''; this.loaded = true; this.sources = [];
    this.#modelConversationId = null;
    this.restoreDraft();
  }

  /** Where `message` stands among the branches at its point: which of how many. */
  branch(message: Message): { index: number; count: number } {
    const siblings = siblingsOf(this.messages, message);
    return { index: siblings.findIndex(m => m.id === message.id), count: siblings.length };
  }

  /** Read the branch `steps` over from `message` — its next or previous sibling, down to that branch's newest end. */
  async switchBranch(message: Message, steps: number) {
    if (this.busy || this.loading || !this.conversation) return;
    const siblings = siblingsOf(this.messages, message);
    const target = siblings[siblings.findIndex(m => m.id === message.id) + steps];
    if (!target) return;
    this.leafId = tipOf(this.messages, target).id;
    // A ghost is read here alone; a saved chat's branch is remembered on the server, so it is the one open everywhere.
    if (this.ghost) { this.conversation = { ...this.conversation, leaf_id: this.leafId }; return; }
    try { this.conversation = await api<Conversation>(`/api/conversations/${this.conversation.id}`, { method: 'PATCH', body: JSON.stringify({ leafId: this.leafId }) }); }
    catch (err) { this.problem = messageOf(err); }
  }

  async send() {
    if (!workspace.canSendFrom(this)) return;
    const text = this.draft.trim();
    // Sent by id: the server resolves them against the one library it was
    // configured with, so nothing here can point it somewhere else.
    const sources = this.sources.map(s => s.id);
    if (this.ghost) {
      // The server holds nothing of a ghost: the branch being read goes with the message.
      await this.#run({
        ghost: true, ...(this.conversation ? { conversationId: this.conversation.id } : {}), projectId: this.projectId, model: this.model, text,
        ...(sources.length ? { sources } : {}), history: historyOf(this.thread), ...this.#thinkingField()
      }, { clear: true });
      return;
    }
    await this.#run({
      conversationId: this.conversation?.id, projectId: this.projectId, model: this.model, text,
      ...(sources.length ? { sources } : {}), ...(this.conversation && this.leafId ? { parentId: this.leafId } : {}), ...this.#thinkingField()
    }, { clear: true });
  }

  /** The thinking choice as the request carries it: nothing, when the instance's setting is to apply. */
  #thinkingField() { return this.thinking === null ? {} : { thinking: this.thinking }; }

  /**
   * Send `message` again with different words: a new turn beside it, under
   * the same parent, quoting the same cards, answered on a new branch. The
   * original stays where it was, one arrow away.
   */
  async edit(message: Message, text: string) {
    text = text.trim();
    if (!text || !this.conversation || !workspace.ready || this.loading || this.busy || this.streaming) return;
    if (message.role !== 'user' || !workspace.data.models.some(m => m.id === this.model)) return;
    const sources = message.sources?.map(s => s.id) ?? [];
    const parent = message.parent_id ?? null;
    if (this.ghost) {
      const at = this.thread.findIndex(m => m.id === message.id);
      if (at < 0) return;
      await this.#run({
        ghost: true, conversationId: this.conversation.id, projectId: this.projectId, model: this.model, text,
        ...(sources.length ? { sources } : {}), history: historyOf(this.thread.slice(0, at)), ...this.#thinkingField()
      }, { parent });
      return;
    }
    await this.#run({
      conversationId: this.conversation.id, projectId: this.projectId, model: this.model, text,
      ...(sources.length ? { sources } : {}), parentId: parent, ...this.#thinkingField()
    }, {});
  }

  /** Answer the message before `message` again, beside it, with this tab's model. */
  async regenerate(message: Message) {
    if (!this.conversation || !workspace.ready || this.loading || this.busy || this.streaming) return;
    if (!workspace.data.models.some(m => m.id === this.model)) return;
    if (this.ghost) {
      // The same question, sent again with the turns before it: the server names nothing, so the tab finds the message itself.
      const asked = this.messages.find(m => m.id === message.parent_id);
      const at = asked ? this.thread.findIndex(m => m.id === asked.id) : -1;
      if (!asked || asked.role !== 'user' || at < 0) return;
      const sources = asked.sources?.map(s => s.id) ?? [];
      await this.#run({
        ghost: true, conversationId: this.conversation.id, projectId: this.projectId, model: this.model, text: asked.content,
        ...(sources.length ? { sources } : {}), history: historyOf(this.thread.slice(0, at)), ...this.#thinkingField()
      }, { again: asked });
      return;
    }
    await this.#run({ conversationId: this.conversation.id, model: this.model, regenerate: message.id, ...this.#thinkingField() }, {});
  }

  /** The last numbered event heard of the response being written, for asking what came after it. */
  #seq = 0;
  /** The response this tab is following. Each event is applied to the row it belongs to. */
  #assistantId = '';

  /**
   * One request to /api/chat, streamed into this tab. `clear` empties the
   * composer once the request is taken; `again` is the user message a ghost
   * chat is having answered again, which the reply is linked under; `parent`
   * is where a ghost's new turn goes when not after the branch being read.
   *
   * A saved response belongs to the server once it is started: if the
   * stream drops before the verdict, the tab listens again for what came
   * after the last event it heard, a few times, before giving up and
   * saying so. A ghost's response has nowhere else to be heard from.
   */
  async #run(body: Record<string, unknown>, { clear = false, again = null as Message | null, parent = undefined as string | null | undefined }) {
    this.busy = true; this.problem = '';
    let accepted = false;
    this.#generation = new AbortController();
    try {
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: this.#generation.signal
      });
      if (response.status === 401) { window.location.assign('/login'); return; }
      if (!response.ok) { const result = await response.json(); throw new Error(result.message || result.error || 'Could not start the response.'); }
      if (!response.body) throw new Error('The response stream is unavailable.');
      const settled = await this.#follow(response.body, event => {
        accepted = true;
        // The request was taken, so the composer empties — attached sources
        // included. A refusal leaves both where they were, to send again.
        if (clear) { this.draft = ''; this.sources = []; this.rememberDraft(); }
        if (this.ghost) {
          // Nothing was written down: the tab links what came back into its own tree,
          // under the question asked again or after the end of the branch being read.
          const user = again ?? { ...event.user, parent_id: parent === undefined ? this.leafId : parent };
          const assistant = { ...event.assistant, parent_id: user.id };
          this.messages = [...this.messages, ...(again ? [] : [user]), assistant];
          // The first answer names the chat; later ones only move its end.
          this.conversation = this.conversation
            ? { ...this.conversation, updated_at: event.conversation.updated_at, leaf_id: assistant.id }
            : event.conversation;
        } else {
          this.conversation = event.conversation;
          // A regeneration's user message is already here; only what is new is added.
          const fresh = [event.user, event.assistant].filter(m => !this.messages.some(x => x.id === m.id));
          this.messages = [...this.messages, ...fresh];
        }
        this.projectId = this.conversation.project_id;
        this.#modelConversationId = this.conversation.id;
        this.rememberDraft();
        this.leafId = event.assistant.id;
        this.startedAt = Date.now();
        this.contextInfo = event.context;
        if (!this.ghost) {
          workspace.data.conversations = [this.conversation, ...workspace.data.conversations.filter(c => c.id !== this.conversation!.id)];
          if (workspace.active === this) replaceState(`/?c=${this.conversation.id}`, {});
        }
      });
      if (!settled) {
        if (accepted && !this.ghost) await this.#resume();
        else throw new Error('Connection interrupted. Reload the conversation to check the saved response.');
      }
    } catch (err) {
      this.#dropped(err, accepted);
    } finally { this.busy = false; this.#generation = undefined; this.focus(); }
  }

  /**
   * Listen to a response already being written — one this tab started
   * before a reload, or that another tab or device did. The server says
   * everything so far first, then the rest as it comes. Nothing to hear
   * means the row already says how it ended: it is read again.
   */
  async attach() {
    if (this.busy || this.ghost || !this.conversation) return;
    const streaming = this.messages.find(m => m.status === 'streaming');
    if (!streaming) return;
    this.busy = true; this.problem = '';
    this.#generation = new AbortController();
    this.#assistantId = streaming.id;
    try {
      const response = await fetch(`/api/chat/stream?conversationId=${encodeURIComponent(this.conversation.id)}`, { signal: this.#generation.signal });
      if (response.status === 401) { window.location.assign('/login'); return; }
      if (response.status === 404) { await this.load(this.conversation.id); return; }
      if (!response.ok || !response.body) throw new Error('Could not follow the response.');
      if (!(await this.#follow(response.body))) await this.#resume();
    } catch (err) {
      this.#dropped(err, true);
    } finally { this.busy = false; this.#generation = undefined; }
  }

  /** Ask for what came after the last event heard, with a short wait between tries. */
  async #resume() {
    const id = this.conversation?.id;
    if (!id) return;
    for (let attempt = 0; attempt < 4; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
      if (this.#generation?.signal.aborted) return;
      let response: Response;
      try { response = await fetch(`/api/chat/stream?conversationId=${encodeURIComponent(id)}&after=${this.#seq}`, { signal: this.#generation?.signal }); }
      catch { continue; }
      if (response.status === 401) { window.location.assign('/login'); return; }
      // Nothing to hear: the response ended while the connection was down, and the row says how.
      if (response.status === 404) { await this.load(id); return; }
      if (!response.ok || !response.body) continue;
      if (await this.#follow(response.body)) return;
    }
    throw new Error('Connection lost. The response goes on being written on the server; reload the conversation to read it.');
  }

  /**
   * Apply a stream's events to this tab. `onstart` handles the opening
   * event of a fresh request; a snapshot opens a stream joined late.
   * Resolves true once the verdict arrives, false if the stream ended
   * without one.
   */
  async #follow(stream: ReadableStream<Uint8Array>, onstart?: (event: Extract<ChatEvent, { type: 'start' }>) => void): Promise<boolean> {
    const written = () => this.messages.find(m => m.id === this.#assistantId);
    for await (const payload of eventData(stream)) {
      const event: ChatEvent = JSON.parse(payload);
      if (event.type === 'start') {
        this.#assistantId = event.assistant.id; this.#seq = 0;
        onstart?.(event);
      } else if (event.type === 'snapshot') {
        const m = written();
        if (m) { m.content = event.content; m.thinking = event.thinking; m.thinking_ms = event.thinking_ms; }
        this.#seq = event.seq;
        this.startedAt = Date.now() - event.elapsed_ms;
      } else if (event.type === 'thinking') {
        const m = written();
        if (m) { if (m.thinking === null) m.thinking = ''; m.thinking += event.text; }
        if (event.seq) this.#seq = event.seq;
      } else if (event.type === 'delta') {
        const m = written();
        if (m) {
          if (m.thinking !== null && m.thinking_ms === null) m.thinking_ms = Date.now() - this.startedAt;
          m.content += event.text;
        }
        if (event.seq) this.#seq = event.seq;
      } else if (event.type === 'done') {
        const m = written();
        if (m) {
          m.status = event.status; m.error = event.error || null;
          if (event.thinking_ms !== undefined) m.thinking_ms = event.thinking_ms;
          if (event.usage) Object.assign(m, event.usage);
        }
        return true;
      } else if (event.type === 'error') throw new Error(event.error);
    }
    return false;
  }

  /** The stream is gone for good: say so, and mark the turn if it was left half-written. */
  #dropped(err: unknown, accepted: boolean) {
    this.problem = messageOf(err);
    if (accepted) {
      const m = this.messages.find(x => x.id === this.#assistantId);
      if (m?.status === 'streaming') { m.status = 'interrupted'; m.error = this.ghost ? 'Connection lost.' : 'Connection lost. Reload to check the saved response.'; }
    }
  }

  async stop() {
    if (!this.conversation) { this.#generation?.abort(); return; }
    try { await api('/api/chat/cancel', { method: 'POST', body: JSON.stringify({ conversationId: this.conversation.id }) }); }
    catch (err) { this.problem = messageOf(err); this.#generation?.abort(); }
  }

  /** Re-fetch the open conversation, and follow its response if one is still being written. A ghost has nothing to fetch. */
  async reload() { if (this.conversation && !this.ghost) await this.load(this.conversation.id); }
}

class Workspace {
  data = $state<Bootstrap>(EMPTY);
  ready = $state(false);
  sessions = $state<Session[]>([new Session()]);
  activeKey = $state(this.sessions[0].key);
  /** Set once stored tabs have been restored, so nothing persists over them first. */
  tabsReady = $state(false);
  /** Whether the archive may hold conversations older than the ones in hand. */
  moreConversations = $state(true);
  loadingOlder = $state(false);
  /** One page at a time: a second click while a page is in flight is nothing. */
  #loadingOlder = false;

  active = $derived(this.sessions.find(s => s.key === this.activeKey) ?? this.sessions[0]);
  activeIndex = $derived(this.sessions.findIndex(s => s.key === this.activeKey));
  /** Conversations open in some tab. */
  openIds = $derived(new Set(this.sessions.map(s => s.conversation?.id).filter((id): id is string => !!id)));

  /* The active tab, under the names components read. `messages` is the
   * branch being read — the transcript's list — not every branch there is. */
  get current() { return this.active.conversation; }
  get messages() { return this.active.thread; }
  get projectId() { return this.active.projectId; }
  get model() { return this.active.model; }
  get draft() { return this.active.draft; }
  set draft(value: string) { this.active.draft = value; }
  get sources() { return this.active.sources; }
  get problem() { return this.active.problem; }
  set problem(value: string) { this.active.problem = value; }
  get contextInfo() { return this.active.contextInfo; }
  get loading() { return this.active.loading; }
  get busy() { return this.active.busy; }
  get streaming() { return this.active.streaming; }
  get focusTick() { return this.active.focusTick; }
  set focusTick(value: number) { this.active.focusTick = value; }

  project = $derived(this.data.projects.find(p => p.id === this.projectId) ?? null);
  visibleConversations = $derived(this.data.conversations.filter(c => !this.projectId || c.project_id === this.projectId));
  selectedModel = $derived(this.data.models.find(m => m.id === this.model) ?? null);
  modelUnavailable = $derived(!!this.model && !this.selectedModel);
  canSend = $derived(this.canSendFrom(this.active));

  canSendFrom(s: Session) {
    return this.ready && !s.loading && !s.busy && !!s.draft.trim()
      && this.data.models.some(m => m.id === s.model) && !s.streaming;
  }

  /** The tab holding a conversation, if one does. */
  holder(id: string | null | undefined): Session | null {
    return id ? this.sessions.find(s => s.conversation?.id === id) ?? null : null;
  }

  rememberDraft() { this.active.rememberDraft(); }
  toggleSource(source: SelectedSource) { this.active.toggleSource(source); }
  removeSource(id: string) { this.active.removeSource(id); }

  /** The active tab is a ghost chat. */
  get ghost() { return this.active.ghost; }
  /** Only a tab with nothing in it yet can become a ghost or stop being one: what a chat is, it is from its first message. */
  canToggleGhost = $derived(this.active.fresh);

  /** Make the blank active tab a ghost chat, or a saved one again. Its draft goes with it either way. */
  toggleGhost() {
    const s = this.active;
    if (!s.fresh) return;
    if (s.ghost) { s.ghost = false; s.rememberDraft(); }
    else { s.forgetDraft(); s.ghost = true; }
    s.focus();
  }

  /* corpus, read-only and server-side: the browser asks amalgam, amalgam asks corpus. */

  /** The diagnostic. `refresh` is the "Check now" button, asking past the server's half-minute cache. */
  corpusStatus(refresh = false) {
    return api<CorpusDiagnostic>(`/api/integrations/corpus${refresh ? '?refresh=1' : ''}`);
  }

  corpusSearch(query: string, limit = 10) {
    return api<CorpusSearchResult>('/api/integrations/corpus/search', { method: 'POST', body: JSON.stringify({ q: query, limit }) });
  }

  async boot() {
    try {
      prefs.hydrate();
      if (!this.active.model) this.active.model = prefs.model;
      await this.refresh();
      this.ready = true;
      this.#restoreTabs();
      this.tabsReady = true;
      const id = new URL(location.href).searchParams.get('c');
      if (id) await this.open(id);
      else await this.activate(this.activeKey);
    } catch (err) { this.problem = messageOf(err); }
  }

  dispose() { for (const s of this.sessions) s.abort(); }

  async refresh() {
    this.data = await api<Bootstrap>('/api/bootstrap');
    // A full page is the only sign there is more; a short one is the end.
    this.moreConversations = this.data.conversations.length >= CONVERSATION_PAGE;
    // Default only a never-selected session. Catalog failure/removal must not
    // silently move a person's next message to another model or provider.
    for (const s of this.sessions) if (!s.model) s.model = this.data.models[0]?.id || '';
  }

  chooseModel(id: string) {
    if (this.loading || this.busy || !this.data.models.some(m => m.id === id)) return;
    this.active.selectModel(id);
    prefs.setModel(id);
  }

  /* ------------------------------------------------------------------
   * Tabs
   * ---------------------------------------------------------------- */

  #restoreTabs() {
    try {
      const raw = sessionStorage.getItem(TABS_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as { tabs: { id: string | null; title?: string; project: string | null; model?: string; ghost?: boolean; thinking?: boolean }[]; active: number };
      if (!Array.isArray(stored.tabs) || !stored.tabs.length) return;
      const seen = new Set<string>();
      const sessions: Session[] = [];
      for (const t of stored.tabs.slice(0, MAX_TABS)) {
        if (t.id && seen.has(t.id)) continue;
        const s = new Session(this.active.model);
        // A ghost comes back as the blank ghost tab it began as: what it held was never stored.
        if (t.ghost === true) { s.ghost = true; s.projectId = t.project ?? null; }
        else if (t.id) {
          seen.add(t.id);
          s.conversation = this.data.conversations.find(c => c.id === t.id) ?? stub(t.id, t.title || 'Conversation', t.project ?? null);
          s.projectId = s.conversation.project_id;
        } else s.projectId = t.project ?? null;
        if (typeof t.model === 'string' && t.model) s.selectModel(t.model);
        if (typeof t.thinking === 'boolean') s.thinking = t.thinking;
        sessions.push(s);
      }
      if (!sessions.length) return;
      this.sessions = sessions;
      this.activeKey = sessions[Math.min(Math.max(Number(stored.active) || 0, 0), sessions.length - 1)].key;
    } catch { /* corrupt storage — one blank tab */ }
  }

  /** Called from an effect on the page, so it runs whenever the tabs change. A ghost tab is stored as its place and scope, never its chat. */
  persistTabs() {
    const tabs = this.sessions.map(s => ({
      ...(s.ghost
        ? { id: null, project: s.projectId, model: s.rememberedModel, ghost: true }
        : { id: s.conversation?.id ?? null, title: s.conversation?.title, project: s.projectId, model: s.rememberedModel }),
      ...(s.thinking === null ? {} : { thinking: s.thinking })
    }));
    const active = this.activeIndex;
    if (!this.tabsReady) return;
    try { sessionStorage.setItem(TABS_KEY, JSON.stringify({ tabs, active })); } catch { /* storage may be disabled */ }
  }

  /** Bring a tab to the front, fetching its conversation the first time. */
  async activate(key: string) {
    const s = this.sessions.find(t => t.key === key);
    if (!s) return;
    this.activeKey = key;
    replaceState(s.conversation && !s.ghost ? `/?c=${s.conversation.id}` : '/', {});
    if (!s.loaded) {
      if (s.conversation) await s.load(s.conversation.id);
      else { s.loaded = true; s.restoreDraft(); }
    }
    s.focus();
  }

  /** A conversation in a tab of its own, beside the active one. */
  async openTab(id: string, { activate = true } = {}) {
    const holder = this.holder(id);
    if (holder) { if (activate) await this.activate(holder.key); return; }
    if (this.sessions.length >= MAX_TABS) { this.problem = `Up to ${MAX_TABS} chats can be open at once. Close one first.`; return; }
    const s = new Session(this.active.model);
    s.conversation = this.data.conversations.find(c => c.id === id) ?? stub(id, 'Conversation', null);
    s.projectId = s.conversation.project_id;
    this.sessions.splice(this.activeIndex + 1, 0, s);
    if (activate) await this.activate(s.key);
    else void s.load(id);
  }

  /** A blank tab, beside the active one, in the active one's project. */
  async newTab(scope: string | null = this.projectId) {
    if (this.sessions.length >= MAX_TABS) { this.problem = `Up to ${MAX_TABS} chats can be open at once. Close one first.`; return; }
    const s = new Session(this.active.model);
    s.blank(scope);
    this.sessions.splice(this.activeIndex + 1, 0, s);
    await this.activate(s.key);
  }

  /** Close a tab. A saved response it is following goes on being written on the server, to be read later; a ghost chat is gone with it, response and all. Closing the last chat leaves a blank tab; a lone blank tab has nothing to close. */
  closeTab(key: string) {
    const index = this.sessions.findIndex(s => s.key === key);
    if (index < 0) return;
    const s = this.sessions[index];
    if (this.sessions.length === 1 && s.fresh && !s.ghost) return;
    const [closed] = this.sessions.splice(index, 1);
    closed.abort();
    if (!this.sessions.length) this.sessions.push(new Session(closed.model));
    if (this.activeKey === key) void this.activate(this.sessions[Math.min(index, this.sessions.length - 1)].key);
  }

  /** Open a conversation in the active tab — or switch to the tab that has it. A tab that is writing, or a ghost chat with anything in it, keeps its place: the conversation opens beside it. */
  async open(id: string) {
    const holder = this.holder(id);
    // Activating also fetches a restored tab that has not shown its content yet.
    if (holder) { await this.activate(holder.key); return; }
    if (this.active.busy || (this.active.ghost && !this.active.fresh)) { await this.openTab(id); return; }
    const s = this.active;
    if (await s.load(id) && this.active === s) { replaceState(`/?c=${id}`, {}); s.focus(); }
  }

  /** A blank conversation, optionally scoped to a project. A tab that is already blank takes it (rescoped); any other — a chat being read or written — keeps its place, and the blank one opens in a tab beside it. */
  newChat(scope: string | null = null) {
    const s = this.active;
    if (!s.fresh) { void this.newTab(scope); return; }
    s.blank(scope);
    replaceState('/', {});
    s.focus();
  }

  send() { return this.active.send(); }
  stop() { return this.active.stop(); }
  reload() { return this.active.reload(); }

  /** Answer again, beside `message`, with `model` — which becomes this tab's model, as the picker would make it. */
  async regenerate(message: Message, model: string) {
    if (this.loading || this.busy || !this.data.models.some(m => m.id === model)) return;
    this.active.selectModel(model);
    prefs.setModel(model);
    await this.active.regenerate(message);
  }

  switchBranch(message: Message, steps: number) { return this.active.switchBranch(message, steps); }

  /** Send a message of the active tab again, with new words, as a branch beside it. */
  edit(message: Message, text: string) { return this.active.edit(message, text); }

  /** Whether the active tab's replies are asked to think first: its own choice, else the instance's setting. */
  get thinking() { return this.active.thinking ?? this.data.settings.thinking; }
  /** True while the tab has a choice of its own, apart from the instance's setting. */
  get thinkingChosen() { return this.active.thinking !== null; }
  /** Choose for this tab, or null to follow the instance's setting again. */
  setThinking(value: boolean | null) { this.active.thinking = value; }

  async rename(id: string, title: string) {
    const holder = this.holder(id);
    // A ghost's name is the tab's alone.
    if (holder?.ghost && holder.conversation) { holder.conversation = { ...holder.conversation, title }; return; }
    const updated = await api<Conversation>(`/api/conversations/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
    if (holder) holder.conversation = updated;
    await this.refresh();
  }

  /** Delete a conversation. Deleting a ghost chat forgets it, as closing its tab would; the tab stays, blank and still a ghost. */
  async remove(id = this.current?.id) {
    if (!id) return;
    const holder = this.holder(id);
    if (holder?.busy) return;
    if (!holder?.ghost) await api(`/api/conversations/${id}`, { method: 'DELETE' });
    if (holder) {
      holder.draft = ''; holder.sources = []; holder.rememberDraft();
      holder.blank(holder.projectId);
      if (holder === this.active) replaceState('/', {});
    }
    if (!holder?.ghost) await this.refresh();
  }

  async saveProject(id: string | null, name: string, instructions: string): Promise<Project> {
    const value = await api<Project>(id ? `/api/projects/${id}` : '/api/projects', {
      method: id ? 'PATCH' : 'POST', body: JSON.stringify({ name, instructions })
    });
    await this.refresh();
    return value;
  }

  async deleteProject(id: string) {
    await api(`/api/projects/${id}`, { method: 'DELETE' });
    await this.refresh();
    for (const s of this.sessions) {
      if (s.projectId === id) s.projectId = null;
      if (s.conversation?.project_id === id) s.conversation.project_id = null;
    }
  }

  async saveSettings(value: ChatSettings) {
    this.data.settings = await api<ChatSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(value) });
  }

  async search(query: string): Promise<Conversation[]> {
    return api<Conversation[]>(`/api/conversations?q=${encodeURIComponent(query)}`);
  }

  /**
   * The next page of the archive, asked for by where the list ends rather
   * than by an offset, so rows moving up while someone reads cannot skip or
   * repeat one. Appended, since the page carries on where the list stops.
   */
  async loadOlderConversations() {
    if (this.#loadingOlder || !this.moreConversations) return;
    const last = this.data.conversations[this.data.conversations.length - 1];
    if (!last) { this.moreConversations = false; return; }
    this.#loadingOlder = true;
    this.loadingOlder = true;
    try {
      const older = await api<Conversation[]>(
        `/api/conversations?before=${encodeURIComponent(last.updated_at)}&beforeId=${encodeURIComponent(last.id)}`
      );
      const known = new Set(this.data.conversations.map(c => c.id));
      this.data.conversations = [...this.data.conversations, ...older.filter(c => !known.has(c.id))];
      this.moreConversations = older.length >= CONVERSATION_PAGE;
    } catch (err) { this.problem = messageOf(err); }
    finally { this.#loadingOlder = false; this.loadingOlder = false; }
  }

  async copy(text: string): Promise<boolean> {
    if (await copyText(text)) return true;
    this.problem = 'Clipboard unavailable. Select and copy the text instead.';
    return false;
  }

  exportConversation() {
    const s = this.active;
    if (!s.conversation) return;
    // Every branch, with parent links, and the one that was open.
    const blob = new Blob([JSON.stringify({ version: 2, conversation: s.conversation, leaf: s.leafId, messages: s.messages }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `amalgam-${s.conversation.id}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ------------------------------------------------------------------
   * Access: the devices signed in, and the tokens handed to integrations.
   * Loaded when Settings opens that panel, never on boot — it is a rarely
   * visited page and the rest of the app never needs it.
   * ---------------------------------------------------------------- */

  listSessions() { return api<DeviceSession[]>('/api/sessions'); }

  revokeSession(id: string) { return api<{ ok: true }>(`/api/sessions/${id}`, { method: 'DELETE' }); }

  listTokens() { return api<IntegrationToken[]>('/api/tokens'); }

  /** What was sent and received over a period. Ghost chats are written nowhere, so they count nowhere. */
  /** Today is the browser's day: its zone goes with the question. */
  usage(period: UsageSummary['period']) {
    let zone = '';
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* no zone to name */ }
    return api<UsageSummary>(`/api/usage?period=${period}${zone ? `&tz=${encodeURIComponent(zone)}` : ''}`);
  }

  /** The returned `secret` is the only time this value exists outside the browser holding it. */
  createToken(name: string, scopes: Scope[], expiresInDays: number | null) {
    return api<IntegrationToken>('/api/tokens', { method: 'POST', body: JSON.stringify({ name, scopes, expiresInDays }) });
  }

  revokeToken(id: string) { return api<{ ok: true }>(`/api/tokens/${id}`, { method: 'DELETE' }); }

  async logout() {
    await api('/api/logout', { method: 'POST' });
    try { sessionStorage.clear(); } catch { /* storage may be disabled */ }
    window.location.assign('/login');
  }
}

export const workspace = new Workspace();
