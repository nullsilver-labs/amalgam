export type MessageStatus = 'complete' | 'streaming' | 'cancelled' | 'failed' | 'interrupted';
export interface Project { id: string; name: string; instructions: string; created_at: string }
export interface Conversation {
  id: string; title: string; project_id: string | null; created_at: string; updated_at: string;
}
export interface Message {
  id: string; conversation_id: string; role: 'user' | 'assistant'; content: string;
  status: MessageStatus; model: string | null; error: string | null; created_at: string;
  /** For a user message: the corpus cards whose text was quoted ahead of it. Null for every other message. */
  sources: MessageSource[] | null;
}
/** One corpus card as a sent message remembers it — enough to name and link it after a reload. */
export interface MessageSource {
  id: string; title: string; card_type: string; original_uri: string | null;
  /** Characters of the card's text that were actually sent, after trimming. */
  chars: number;
}
/** `window` is the context size declared for the model in its `_MODELS` entry, in tokens, or null when none was. */
export interface ModelOption { id: string; name: string; provider: string; destination: string; window: number | null }
/** A pill under the composer on a new chat: its label, and what it drops into the composer. */
export interface Suggestion { label: string; text: string }
/** Instance-wide chat settings, stored on the server and editable in Settings. */
export interface ChatSettings { systemPrompt: string; suggestions: Suggestion[]; contextTokens: number }
/** The instance's context ceiling until Settings says otherwise: estimated tokens a request may carry. */
export const DEFAULT_CONTEXT_TOKENS = 32_000;
export const DEFAULT_SETTINGS: ChatSettings = {
  systemPrompt: '',
  contextTokens: DEFAULT_CONTEXT_TOKENS,
  suggestions: [
    { label: 'Draft something', text: 'Help me draft ' },
    { label: 'Think it through', text: 'Help me think through a decision. Ask me what I am weighing up.' },
    { label: 'Explain a topic', text: 'Explain, simply and without hand-waving: ' },
    { label: 'Summarise text', text: 'Summarise the following in a short paragraph and three bullet points:\n\n' }
  ]
};
/** What one request carried: `tokens` estimated of a `budget` allowed, against the model's declared `window` if any. */
export interface ContextInfo {
  messages: number; truncated: boolean; project: boolean; system: boolean;
  tokens: number; budget: number; window: number | null;
  /** Absent on requests made before the corpus connector existed, and on requests that attached nothing. */
  sources?: { count: number; tokens: number; truncated: boolean };
}
export interface Bootstrap {
  conversations: Conversation[]; projects: Project[]; models: ModelOption[];
  integrations: { corpus: CorpusIntegration; embeddings: boolean };
  settings: ChatSettings;
}

/* ------------------------------------------------------------------
 * corpus — a read-only connector to the owner's own library
 * ---------------------------------------------------------------- */

/**
 * What the last conversation with corpus established. Reachability and
 * authorisation are deliberately different answers: a library that answers the
 * door has not thereby agreed to be read.
 */
export type CorpusState = 'ok' | 'unreachable' | 'unauthenticated' | 'forbidden' | 'wrong_host' | 'rate_limited' | 'error';
/** What the browser is told about the connector at boot: whether it exists, and the address a person can click. */
export interface CorpusIntegration {
  configured: boolean;
  /** `CORPUS_PUBLIC_URL`, or '' — the browser-reachable address of corpus, if the operator set one. */
  publicUrl: string;
}
/** The diagnostic panel's whole answer. `endpoint` is a host and port, never a token or a path. */
export interface CorpusDiagnostic {
  configured: boolean; endpoint: string; state: CorpusState; detail: string; checked_at: string;
}
/** One search result, already stripped of everything the browser has no business seeing. */
export interface CorpusHit {
  id: string; title: string; excerpt: string; snippet: string;
  card_type: string; original_uri: string | null; created_at: string;
}
/** `semantic` is false when corpus's embedder is down and it answered lexically. */
export interface CorpusSearchResult {
  state: CorpusState; detail: string; semantic: boolean; hits: CorpusHit[];
}
/** A source the composer is holding, before it has been sent with anything. */
export interface SelectedSource { id: string; title: string; card_type: string }
/** The four things a credential may be allowed to do. A browser session holds all four. */
export type Scope = 'read' | 'write' | 'generate' | 'admin';
/** One signed-in browser, as Settings › Access lists it. */
export interface DeviceSession {
  id: string; device: string; created_at: string; last_seen_at: string; expires_at: string; current: boolean;
}
/** One integration token. `secret` is present only in the response that created it. */
export interface IntegrationToken {
  id: string; name: string; scopes: Scope[];
  created_at: string; last_used_at: string | null; expires_at: string | null;
  secret?: string;
}
export interface ChatTurn { role: 'system' | 'user' | 'assistant'; content: string }
export type ChatEvent =
  | { type: 'start'; conversation: Conversation; user: Message; assistant: Message; context: ContextInfo }
  | { type: 'delta'; text: string }
  | { type: 'done'; status: MessageStatus; error?: string }
  | { type: 'error'; error: string };
