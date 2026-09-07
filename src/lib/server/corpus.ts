import type { CorpusHit, CorpusState } from '../types';

/*
 * The one place amalgam reads from corpus.
 *
 * corpus is a separate application with its own owner, its own password and its
 * own tokens. amalgam is a client of it and nothing more: it holds an address
 * (CORPUS_BASE_URL) and a bearer token minted over there with the `read` scope
 * and nothing else (CORPUS_TOKEN), and it calls exactly three routes —
 * GET /api/status, POST /api/search and GET /api/cards/{id}. There is no
 * capture, no write, no admin, and no route in this module that could grow into
 * one without somebody adding it here on purpose.
 *
 * Two rules shape everything below.
 *
 * The first is that the token never leaves this process. It is read from the
 * environment, put in an Authorization header, and never logged, never returned
 * from a route, never embedded in an error message. Upstream response bodies
 * are not passed through either: corpus's errors are corpus's business, and a
 * proxy that forwards them is a proxy that eventually forwards something
 * private.
 *
 * The second is that reachability is not authorisation. A connection that
 * succeeds tells you the network works; it tells you nothing about whether this
 * token may read that library. So `classify` keeps unreachable, unauthenticated
 * (401), forbidden (403), wrong-host (421) and rate-limited (429) as five
 * different answers with five different fixes, and the diagnostic shows
 * whichever one is true rather than a green light for "the address responded".
 */

export interface CorpusConfig {
  /** Both an address and a token are present: the connector can actually be used. */
  configured: boolean;
  baseUrl: string;
  /** Host and port only — what a diagnostic may show. Never a path, never a credential. */
  endpoint: string;
  /** The browser-reachable address of corpus, when the operator set one. May be ''. */
  publicUrl: string;
  token: string;
  /** Why the connector cannot be used, when it cannot. Names the variable to fix. */
  problem: Diagnosis | null;
}

export interface Diagnosis { state: CorpusState; detail: string }

/** A card fetched whole, as a turn will quote it. */
export interface CorpusSource {
  id: string; title: string; card_type: string; original_uri: string | null;
  created_at: string; body: string;
}

/** How long each call may take. A search happens while somebody waits; a card is bigger. */
export const PROBE_TIMEOUT_MS = 5_000;
export const SEARCH_TIMEOUT_MS = 5_000;
export const CARD_TIMEOUT_MS = 10_000;
/** How much of an answer is read before giving up on it. A library is not a file server. */
const PROBE_LIMIT = 64 * 1024;
const SEARCH_LIMIT = 512 * 1024;
const CARD_LIMIT = 4 * 1024 * 1024;

const OK: Diagnosis = { state: 'ok', detail: 'corpus answered, and this token may read the library.' };

/* ------------------------------------------------------------------
 * Configuration
 * ---------------------------------------------------------------- */

export function corpusConfig(env: Record<string, string | undefined>): CorpusConfig {
  const raw = (env.CORPUS_BASE_URL || '').trim().replace(/\/+$/, '');
  const token = (env.CORPUS_TOKEN || '').trim();
  const publicUrl = (env.CORPUS_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  const empty: CorpusConfig = { configured: false, baseUrl: '', endpoint: '', publicUrl, token: '', problem: null };
  if (!raw) {
    return { ...empty, problem: { state: 'unreachable', detail: 'CORPUS_BASE_URL is not set, so amalgam has no corpus to read — set it to your library\'s address, such as http://corpus:8787.' } };
  }
  let url: URL;
  try { url = new URL(raw); }
  catch {
    return { ...empty, problem: { state: 'error', detail: 'CORPUS_BASE_URL is not a valid absolute address; set it to a full http:// or https:// URL such as http://corpus:8787.' } };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ...empty, problem: { state: 'error', detail: 'CORPUS_BASE_URL must be an http:// or https:// address.' } };
  }
  const endpoint = url.host;
  if (!token) {
    return {
      ...empty, endpoint, baseUrl: raw,
      problem: { state: 'unauthenticated', detail: 'CORPUS_TOKEN is not set, so amalgam has nothing to present — mint one in corpus with `corpus token create "amalgam" --scopes read` and put it in .env.' }
    };
  }
  return { configured: true, baseUrl: raw, endpoint, publicUrl, token, problem: null };
}

/* ------------------------------------------------------------------
 * The diagnosis
 * ---------------------------------------------------------------- */

/**
 * What happened, in one word and one sentence that says what to do about it.
 * Pure: give it a response-shaped `{ status }` or whatever `fetch` threw, and
 * it decides. It reads no body, so nothing of corpus's can leak through it.
 */
export function classify(outcome: unknown): Diagnosis {
  const status = statusOf(outcome);
  if (status !== null) {
    if (status >= 200 && status < 300) return OK;
    if (status === 401) {
      return { state: 'unauthenticated', detail: 'corpus does not recognise CORPUS_TOKEN — mint a token there with `corpus token create "amalgam" --scopes read`, put it in amalgam\'s .env, and recreate the app.' };
    }
    if (status === 403) {
      return { state: 'forbidden', detail: 'corpus knows this token but it does not carry the `read` scope; a token\'s scopes cannot be widened, so create a replacement with `--scopes read`.' };
    }
    if (status === 421) {
      return { state: 'wrong_host', detail: 'corpus refused the Host this address produces — add the service name to CORPUS_SERVER__EXTRA_ALLOWED_HOSTS on corpus, which its compose.apps.yaml already does for the name `corpus`.' };
    }
    if (status === 429) {
      return { state: 'rate_limited', detail: 'corpus is rate limiting this token; wait a moment before asking again.' };
    }
    if (status === 404) {
      return { state: 'error', detail: 'corpus answered 404: either that card is gone, or CORPUS_BASE_URL points at something that is not a corpus API.' };
    }
    return { state: 'error', detail: `corpus answered ${status}, which this connector does not know how to use; its own log will say why.` };
  }
  const name = outcome instanceof Error ? outcome.name : '';
  if (name === 'TimeoutError') {
    return { state: 'unreachable', detail: 'corpus did not answer in time — check that it is running and that CORPUS_BASE_URL names an address this container can reach.' };
  }
  if (name === 'AbortError') {
    return { state: 'unreachable', detail: 'The request to corpus was cut short before it answered.' };
  }
  return { state: 'unreachable', detail: 'amalgam could not open a connection to corpus — check CORPUS_BASE_URL and that both containers share the nullsilver-apps network.' };
}

function statusOf(outcome: unknown): number | null {
  if (!outcome || typeof outcome !== 'object') return null;
  const status = (outcome as { status?: unknown }).status;
  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

/* ------------------------------------------------------------------
 * The three calls
 * ---------------------------------------------------------------- */

export interface CallOptions { fetcher?: typeof fetch }

/** The cheapest read-scoped route corpus has: the honest answer to "may I read this library?" */
export async function probe(config: CorpusConfig, options: CallOptions = {}): Promise<Diagnosis> {
  if (config.problem) return config.problem;
  const result = await call(config, '/api/status', {}, PROBE_TIMEOUT_MS, PROBE_LIMIT, options);
  return result.diagnosis;
}

/** A search, reduced to the fields a browser may see. Never throws for an upstream failure; it reports one. */
export async function search(
  config: CorpusConfig, query: string, limit: number, options: CallOptions = {}
): Promise<{ state: CorpusState; detail: string; semantic: boolean; hits: CorpusHit[] }> {
  if (config.problem) return { ...config.problem, semantic: false, hits: [] };
  const result = await call(config, '/api/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, limit })
  }, SEARCH_TIMEOUT_MS, SEARCH_LIMIT, options);
  if (result.diagnosis.state !== 'ok' || !result.data) return { ...result.diagnosis, semantic: false, hits: [] };
  const payload = result.data as { hits?: unknown; semantic?: unknown };
  const rows = Array.isArray(payload.hits) ? payload.hits : [];
  const hits: CorpusHit[] = [];
  for (const row of rows.slice(0, limit)) {
    const hit = row as { card?: Record<string, unknown>; snippet?: unknown };
    const card = hit.card;
    if (!card || typeof card.id !== 'string' || !card.id) continue;
    hits.push({
      id: card.id,
      title: text(card.title, 300) || 'Untitled',
      excerpt: text(card.excerpt, 500),
      snippet: text(hit.snippet, 500),
      card_type: text(card.card_type, 60) || 'card',
      original_uri: webUri(card.original_uri),
      created_at: text(card.created_at, 40)
    });
  }
  return { state: 'ok', detail: result.diagnosis.detail, semantic: payload.semantic !== false, hits };
}

/**
 * One card, whole. `missing` separates "corpus has no such card" — a stale id in
 * the browser — from a connector that is not working, because the two want very
 * different words in front of the person waiting.
 */
export async function card(
  config: CorpusConfig, id: string, options: CallOptions = {}
): Promise<{ state: CorpusState; detail: string; missing: boolean; source: CorpusSource | null }> {
  if (config.problem) return { ...config.problem, missing: false, source: null };
  const result = await call(config, `/api/cards/${encodeURIComponent(id)}`, {}, CARD_TIMEOUT_MS, CARD_LIMIT, options);
  if (result.diagnosis.state !== 'ok' || !result.data) {
    return { ...result.diagnosis, missing: result.status === 404, source: null };
  }
  const payload = result.data as { card?: Record<string, unknown>; body?: unknown };
  const found = payload.card;
  if (!found || typeof found.id !== 'string') {
    return { state: 'error', detail: 'corpus answered with something that is not a card.', missing: false, source: null };
  }
  return {
    state: 'ok', detail: result.diagnosis.detail, missing: false,
    source: {
      id: found.id,
      title: text(found.title, 300) || 'Untitled',
      card_type: text(found.card_type, 60) || 'card',
      original_uri: webUri(found.original_uri),
      created_at: text(found.created_at, 40),
      body: typeof payload.body === 'string' ? payload.body : ''
    }
  };
}

/* ------------------------------------------------------------------
 * The request itself
 * ---------------------------------------------------------------- */

async function call(
  config: CorpusConfig, path: string, init: RequestInit, timeoutMs: number, limit: number, options: CallOptions
): Promise<{ diagnosis: Diagnosis; status: number | null; data: unknown | null }> {
  const fetcher = options.fetcher || fetch;
  let response: Response;
  try {
    response = await fetcher(`${config.baseUrl}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...init.headers, Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error'
    });
  } catch (err) {
    return { diagnosis: classify(err), status: null, data: null };
  }
  const diagnosis = classify(response);
  if (diagnosis.state !== 'ok') {
    // The body of a failure is corpus's own words about its own internals. Drop it.
    await response.body?.cancel().catch(() => {});
    return { diagnosis, status: response.status, data: null };
  }
  let raw: string;
  try { raw = await readBounded(response, limit); }
  catch {
    return {
      diagnosis: { state: 'error', detail: 'corpus\'s answer was larger than amalgam will read in one request.' },
      status: response.status, data: null
    };
  }
  try { return { diagnosis, status: response.status, data: JSON.parse(raw) }; }
  catch {
    return {
      diagnosis: { state: 'error', detail: 'corpus answered with something that is not JSON; check that CORPUS_BASE_URL points at the API and not at a proxy or a login page.' },
      status: response.status, data: null
    };
  }
}

/** Read a body up to a ceiling, then stop. An endpoint that streams forever must not become our problem. */
async function readBounded(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('response too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

/** A string field, trimmed to something a page can hold. Anything else becomes ''. */
function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** A link is worth showing only if a browser could follow it safely. */
function webUri(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString().slice(0, 2000) : null;
  } catch { return null; }
}
