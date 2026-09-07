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
 * Client-only: `boot()` runs from the page's onMount, and every method
 * assumes a browser (fetch, sessionStorage, the router).
 */

import { replaceState } from '$app/navigation';
import { api } from '$lib/api';
import { eventData } from '$lib/sse';
import { copyText } from '$lib/clipboard';
import { DEFAULT_SETTINGS, type Bootstrap, type ChatEvent, type ChatSettings, type ContextInfo, type Conversation, type CorpusDiagnostic, type CorpusSearchResult, type DeviceSession, type IntegrationToken, type Message, type Project, type Scope, type SelectedSource } from '$lib/types';
import { prefs } from './prefs.svelte';

const EMPTY: Bootstrap = {
  conversations: [], projects: [], models: [],
  integrations: { corpus: { configured: false, publicUrl: '' }, embeddings: false },
  settings: DEFAULT_SETTINGS
};

/** Open tabs survive a reload of this browser tab, like drafts do. */
const TABS_KEY = 'amalgam:tabs';
const MAX_TABS = 20;

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'The connection failed. Try again.';
}

let sequence = 0;

/** A conversation as a tab knows it before its messages have been fetched. */
function stub(id: string, title: string, project_id: string | null): Conversation {
  return { id, title, project_id, created_at: '', updated_at: '' };
}

export class Session {
  /** Tab identity — stable while a blank tab becomes a saved conversation. */
  readonly key = `tab-${++sequence}`;
  conversation = $state<Conversation | null>(null);
  messages = $state<Message[]>([]);
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

  /** A response is being written — by this tab or, after a reload, by nobody. */
  streaming = $derived(this.messages.some(m => m.status === 'streaming'));
  title = $derived(this.conversation?.title ?? 'New chat');

  #requestVersion = 0;
  #generation: AbortController | undefined;

  constructor(model = '') { this.model = model; }

  #scope() { return this.conversation?.id || this.projectId || 'new'; }
  #draftKey() { return `amalgam:draft:${this.#scope()}`; }
  #sourcesKey() { return `amalgam:sources:${this.#scope()}`; }
  rememberDraft() {
    try {
      sessionStorage.setItem(this.#draftKey(), this.draft);
      sessionStorage.setItem(this.#sourcesKey(), JSON.stringify($state.snapshot(this.sources)));
    } catch { /* storage may be disabled */ }
  }
  restoreDraft() {
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
      this.conversation = result.conversation; this.messages = result.messages; this.projectId = this.conversation.project_id;
      this.contextInfo = null; this.loaded = true; this.restoreDraft();
      const lastModel = [...this.messages].reverse().find(m => m.model)?.model;
      if (lastModel && workspace.data.models.some(m => m.id === lastModel)) this.model = lastModel;
      return true;
    } catch (err) { if (version === this.#requestVersion) this.problem = messageOf(err); return false; }
    finally { if (version === this.#requestVersion) this.loading = false; }
  }

  /** A blank conversation, optionally scoped to a project. */
  blank(scope: string | null) {
    ++this.#requestVersion;
    if (this.loaded) this.rememberDraft();
    this.loading = false; this.conversation = null; this.messages = []; this.projectId = scope;
    this.contextInfo = null; this.problem = ''; this.loaded = true; this.sources = [];
    this.restoreDraft();
  }

  async send() {
    if (!workspace.canSendFrom(this)) return;
    const text = this.draft.trim();
    // Sent by id: the server resolves them against the one library it was
    // configured with, so nothing here can point it somewhere else.
    const sources = this.sources.map(s => s.id);
    this.busy = true; this.problem = '';
    let accepted = false, terminal = false;
    this.#generation = new AbortController();
    try {
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: this.conversation?.id, projectId: this.projectId, model: this.model, text, ...(sources.length ? { sources } : {}) }),
        signal: this.#generation.signal
      });
      if (response.status === 401) { window.location.assign('/login'); return; }
      if (!response.ok) { const result = await response.json(); throw new Error(result.message || result.error || 'Could not start the response.'); }
      if (!response.body) throw new Error('The response stream is unavailable.');
      for await (const payload of eventData(response.body)) {
        const event: ChatEvent = JSON.parse(payload);
        if (event.type === 'start') {
          accepted = true;
          // The request was taken, so the composer empties — attached sources
          // included. A refusal leaves both where they were, to send again.
          this.draft = ''; this.sources = []; this.rememberDraft();
          this.conversation = event.conversation; this.projectId = this.conversation.project_id;
          this.rememberDraft();
          this.messages = [...this.messages, event.user, event.assistant];
          this.contextInfo = event.context;
          workspace.data.conversations = [this.conversation, ...workspace.data.conversations.filter(c => c.id !== this.conversation!.id)];
          if (workspace.active === this) replaceState(`/?c=${this.conversation.id}`, {});
        } else if (event.type === 'delta') {
          const last = this.messages[this.messages.length - 1];
          if (last) last.content += event.text;
        } else if (event.type === 'done') {
          terminal = true;
          const last = this.messages[this.messages.length - 1];
          if (last) { last.status = event.status; last.error = event.error || null; }
        } else if (event.type === 'error') { terminal = true; throw new Error(event.error); }
      }
      if (!terminal) throw new Error('Connection interrupted. Reload the conversation to check the saved response.');
    } catch (err) {
      this.problem = messageOf(err);
      if (accepted) {
        const last = this.messages[this.messages.length - 1];
        if (last?.status === 'streaming') { last.status = 'interrupted'; last.error = 'Connection lost. Reload to check the saved response.'; }
      }
    } finally { this.busy = false; this.#generation = undefined; this.focus(); }
  }

  async stop() {
    if (!this.conversation) { this.#generation?.abort(); return; }
    try { await api('/api/chat/cancel', { method: 'POST', body: JSON.stringify({ conversationId: this.conversation.id }) }); }
    catch (err) { this.problem = messageOf(err); this.#generation?.abort(); }
  }

  /** Re-fetch the open conversation — after a reload found a stranded response. */
  async reload() { if (this.conversation) await this.load(this.conversation.id); }
}

class Workspace {
  data = $state<Bootstrap>(EMPTY);
  ready = $state(false);
  sessions = $state<Session[]>([new Session()]);
  activeKey = $state(this.sessions[0].key);
  /** Set once stored tabs have been restored, so nothing persists over them first. */
  tabsReady = $state(false);

  active = $derived(this.sessions.find(s => s.key === this.activeKey) ?? this.sessions[0]);
  activeIndex = $derived(this.sessions.findIndex(s => s.key === this.activeKey));
  /** Conversations open in some tab. */
  openIds = $derived(new Set(this.sessions.map(s => s.conversation?.id).filter((id): id is string => !!id)));

  /* The active tab, under the names components read. */
  get current() { return this.active.conversation; }
  get messages() { return this.active.messages; }
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
  canSend = $derived(this.canSendFrom(this.active));

  canSendFrom(s: Session) { return this.ready && !s.loading && !s.busy && !!s.draft.trim() && !!s.model && !s.streaming; }

  /** The tab holding a conversation, if one does. */
  holder(id: string | null | undefined): Session | null {
    return id ? this.sessions.find(s => s.conversation?.id === id) ?? null : null;
  }

  rememberDraft() { this.active.rememberDraft(); }
  toggleSource(source: SelectedSource) { this.active.toggleSource(source); }
  removeSource(id: string) { this.active.removeSource(id); }

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
      this.active.model = prefs.model;
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
    for (const s of this.sessions) if (!this.data.models.some(m => m.id === s.model)) s.model = this.data.models[0]?.id || '';
  }

  chooseModel(id: string) { this.active.model = id; prefs.setModel(id); }

  /* ------------------------------------------------------------------
   * Tabs
   * ---------------------------------------------------------------- */

  #restoreTabs() {
    try {
      const raw = sessionStorage.getItem(TABS_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as { tabs: { id: string | null; title?: string; project: string | null }[]; active: number };
      if (!Array.isArray(stored.tabs) || !stored.tabs.length) return;
      const seen = new Set<string>();
      const sessions: Session[] = [];
      for (const t of stored.tabs.slice(0, MAX_TABS)) {
        if (t.id && seen.has(t.id)) continue;
        const s = new Session(this.active.model);
        if (t.id) {
          seen.add(t.id);
          s.conversation = this.data.conversations.find(c => c.id === t.id) ?? stub(t.id, t.title || 'Conversation', t.project ?? null);
          s.projectId = s.conversation.project_id;
        } else s.projectId = t.project ?? null;
        sessions.push(s);
      }
      if (!sessions.length) return;
      this.sessions = sessions;
      this.activeKey = sessions[Math.min(Math.max(Number(stored.active) || 0, 0), sessions.length - 1)].key;
    } catch { /* corrupt storage — one blank tab */ }
  }

  /** Called from an effect on the page, so it runs whenever the tabs change. */
  persistTabs() {
    const tabs = this.sessions.map(s => ({ id: s.conversation?.id ?? null, title: s.conversation?.title, project: s.projectId }));
    const active = this.activeIndex;
    if (!this.tabsReady) return;
    try { sessionStorage.setItem(TABS_KEY, JSON.stringify({ tabs, active })); } catch { /* storage may be disabled */ }
  }

  /** Bring a tab to the front, fetching its conversation the first time. */
  async activate(key: string) {
    const s = this.sessions.find(t => t.key === key);
    if (!s) return;
    this.activeKey = key;
    replaceState(s.conversation ? `/?c=${s.conversation.id}` : '/', {});
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

  /** Close a tab. A response it is writing stops, as it would if the page closed. Closing the last chat leaves a blank tab; a lone blank tab has nothing to close. */
  closeTab(key: string) {
    const index = this.sessions.findIndex(s => s.key === key);
    if (index < 0) return;
    const s = this.sessions[index];
    if (this.sessions.length === 1 && !s.conversation && !s.messages.length) return;
    const [closed] = this.sessions.splice(index, 1);
    closed.abort();
    if (!this.sessions.length) this.sessions.push(new Session(closed.model));
    if (this.activeKey === key) void this.activate(this.sessions[Math.min(index, this.sessions.length - 1)].key);
  }

  /** Open a conversation in the active tab — or switch to the tab that has it. A tab that is writing keeps its place: the conversation opens beside it. */
  async open(id: string) {
    const holder = this.holder(id);
    // Activating also fetches a restored tab that has not shown its content yet.
    if (holder) { await this.activate(holder.key); return; }
    if (this.active.busy) { await this.openTab(id); return; }
    const s = this.active;
    if (await s.load(id) && this.active === s) { replaceState(`/?c=${id}`, {}); s.focus(); }
  }

  /** A blank conversation, optionally scoped to a project. A tab that is already blank takes it (rescoped); any other — a chat being read or written — keeps its place, and the blank one opens in a tab beside it. */
  newChat(scope: string | null = null) {
    const s = this.active;
    const fresh = !s.conversation && !s.messages.length && !s.busy && !s.loading;
    if (!fresh) { void this.newTab(scope); return; }
    s.blank(scope);
    replaceState('/', {});
    s.focus();
  }

  send() { return this.active.send(); }
  stop() { return this.active.stop(); }
  reload() { return this.active.reload(); }

  async rename(id: string, title: string) {
    const updated = await api<Conversation>(`/api/conversations/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
    const holder = this.holder(id);
    if (holder) holder.conversation = updated;
    await this.refresh();
  }

  async remove(id = this.current?.id) {
    if (!id) return;
    const holder = this.holder(id);
    if (holder?.busy) return;
    await api(`/api/conversations/${id}`, { method: 'DELETE' });
    if (holder) {
      holder.draft = ''; holder.sources = []; holder.rememberDraft();
      holder.blank(holder.projectId);
      if (holder === this.active) replaceState('/', {});
    }
    await this.refresh();
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

  async copy(text: string): Promise<boolean> {
    if (await copyText(text)) return true;
    this.problem = 'Clipboard unavailable. Select and copy the text instead.';
    return false;
  }

  exportConversation() {
    const s = this.active;
    if (!s.conversation) return;
    const blob = new Blob([JSON.stringify({ version: 1, conversation: s.conversation, messages: s.messages }, null, 2)], { type: 'application/json' });
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
