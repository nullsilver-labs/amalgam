export type MessageStatus = 'complete' | 'streaming' | 'cancelled' | 'failed' | 'interrupted';
export interface Project { id: string; name: string; instructions: string; created_at: string }
export interface Conversation {
  id: string; title: string; project_id: string | null; created_at: string; updated_at: string;
  /** The message the conversation was last read at — the end of the branch that opens. Null until the first exchange. */
  leaf_id: string | null;
}
export interface Message {
  id: string; conversation_id: string; role: 'user' | 'assistant'; content: string;
  status: MessageStatus; model: string | null; error: string | null; created_at: string;
  /** For a user message: the corpus cards whose text was quoted ahead of it. Null for every other message. */
  sources: MessageSource[] | null;
  /** The message this one follows; null at the root. Messages sharing a parent are branches — a regenerated answer beside the first. */
  parent_id: string | null;
  /** For an assistant message: the reasoning the model showed before its answer, '' when it reported thinking but showed none, null when it reported none. */
  thinking: string | null;
  /** Milliseconds from the request to the first character of the answer. Kept only when the model reported thinking. */
  thinking_ms: number | null;
  /** For an assistant message: what the request it answered cost, as the provider counted it or as estimated from characters. */
  input_tokens: number | null;
  output_tokens: number | null;
  /** True when the counts are estimates: the provider reported none. */
  tokens_estimated: boolean | null;
  /** Milliseconds from the request to the first piece of the reply, and to its last. */
  first_token_ms: number | null;
  duration_ms: number | null;
}
/** One corpus card as a sent message remembers it — enough to name and link it after a reload. */
export interface MessageSource {
  id: string; title: string; card_type: string; original_uri: string | null;
  /** Characters of the card's text that were actually sent, after trimming. */
  chars: number;
}
/**
 * `window` is the context size declared for the model in its `_MODELS` entry, in tokens, or null when none was.
 * `kind` is the protocol its provider speaks, which decides what a thinking option can do: the Anthropic API takes
 * one; an OpenAI-style server takes none, and its models reason as they will.
 */
export interface ModelOption { id: string; name: string; provider: string; destination: string; window: number | null; kind: 'openai' | 'anthropic' }
/** A pill under the composer on a new chat: its label, and what it drops into the composer. */
export interface Suggestion { label: string; text: string }
/**
 * Instance-wide chat settings, stored on the server and editable in Settings.
 * `thinking` asks models to think before answering: Claude models are sent
 * adaptive thinking with a shown summary, and every reply keeps extra room
 * for it. Reasoning a model sends of its own accord is shown either way.
 */
export interface ChatSettings {
  systemPrompt: string; suggestions: Suggestion[]; contextTokens: number; thinking: boolean;
  /** How long a response may take, in minutes, before it is stopped. */
  responseMinutes: number;
  /** Show what each exchange cost and how fast it came, under the messages. */
  stats: boolean;
}
/** The instance's context ceiling until Settings says otherwise: estimated tokens a request may carry. */
export const DEFAULT_CONTEXT_TOKENS = 32_000;
export const DEFAULT_RESPONSE_MINUTES = 10;
export const DEFAULT_SETTINGS: ChatSettings = {
  systemPrompt: '',
  contextTokens: DEFAULT_CONTEXT_TOKENS,
  thinking: true,
  responseMinutes: DEFAULT_RESPONSE_MINUTES,
  stats: false,
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
/** Public catalog feedback: host only, no credentials, paths or raw upstream errors. */
export interface ModelConnection {
  id: string; name: string; destination: string;
  state: 'explicit' | 'manual' | 'discovered' | 'stale' | 'error';
  detail: string; checkedAt: string | null;
}
export interface Bootstrap {
  conversations: Conversation[]; projects: Project[]; models: ModelOption[];
  modelConnections: ModelConnection[];
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
/**
 * One turn of a ghost chat as the browser sends it back. A ghost chat is
 * written nowhere — not the database, not the browser's storage — so each
 * request carries the branch being read, and the server reads it the way it
 * reads a saved conversation's rows: a turn that did not complete is shown in
 * the transcript but never given to the model as an answer.
 */
export interface HistoryTurn { role: 'user' | 'assistant'; content: string; status?: MessageStatus }
/** The most turns a ghost request carries: the newest ones, as a saved conversation's path is read to a depth. */
export const GHOST_HISTORY_TURNS = 200;
/**
 * What a response stream says. `start` opens a fresh request; `snapshot`
 * opens a stream that joined a response already being written, carrying
 * everything said so far. The rest are numbered by `seq` from 1, so a
 * listener that lost its connection can ask for what came after the last
 * one it heard. A response ends with `done`, or with `error` when it could
 * not be saved.
 */
export type ChatEvent =
  | { type: 'start'; conversation: Conversation; user: Message; assistant: Message; context: ContextInfo }
  | { type: 'snapshot'; content: string; thinking: string | null; thinking_ms: number | null; seq: number; elapsed_ms: number }
  | { type: 'delta'; text: string; seq?: number }
  /** Reasoning, as the model shows it. Sent with empty text when a model reports thinking without showing any. */
  | { type: 'thinking'; text: string; seq?: number }
  | { type: 'done'; status: MessageStatus; error?: string; thinking_ms?: number; seq?: number; usage?: Usage }
  | { type: 'error'; error: string; seq?: number };

/** What a response cost and how fast it came, as the row keeps it. */
export interface Usage {
  input_tokens: number | null; output_tokens: number | null; tokens_estimated: boolean;
  first_token_ms: number | null; duration_ms: number;
}
/** Settings › Usage: totals over a period, and the same by model. Ghost chats are written nowhere and so count nowhere. */
export interface UsageSummary {
  period: 'today' | 'week' | 'month' | 'all';
  /** When the period begins, ISO; null for all time. */
  since: string | null;
  responses: number; input_tokens: number; output_tokens: number;
  /** How many of those responses carry estimates rather than the provider's counts. */
  estimated: number;
  models: { model: string; responses: number; input_tokens: number; output_tokens: number }[];
}
