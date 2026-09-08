import type { ChatEvent, MessageStatus, Usage } from '../types';
import { ProviderError, type Piece } from './providers';
import { estimateTokens } from './context';

/*
 * A response being written belongs to the server, not to the request that
 * asked for it. The request starts a job and listens; if the browser goes
 * away — a closed tab, a reload, a connection that dropped — the job goes
 * on, checkpointing into its row, and any later request can listen again
 * from where it left off, because every event the job emits is numbered
 * and kept until the job is done.
 *
 * One application instance: the registry is a map in memory, and the
 * database's one-streaming-message-per-conversation index is what makes
 * that safe. A restart loses the jobs; what they had checkpointed stays,
 * and the startup pass marks those rows interrupted, in words.
 *
 * A ghost chat is the exception by design: nothing of it is written down,
 * so its job ends when its request does.
 */

/** One thing the job said: reasoning, answer text, or its verdict — numbered once emitted. */
type Said = Extract<ChatEvent, { type: 'thinking' | 'delta' | 'done' | 'error' }>;
export type JobEvent = Said & { seq: number };

/** Where a saved response is written as it streams — none for a ghost. */
export interface Persist {
  checkpoint(content: string, thought: string | null): Promise<void>;
  finish(content: string, status: MessageStatus, failure: string | undefined, thought: string | null, thinkingMs: number | null, usage: Usage): Promise<void>;
}

/** The most a response may run to, in characters, thinking and answer each. */
const MAX_CHARS = 200_000;

export class Job {
  readonly controller = new AbortController();
  readonly startedAt = Date.now();
  /** Everything said so far, in order. Replayed to anyone who listens late. */
  readonly events: JobEvent[] = [];
  content = '';
  /** What the model showed of its reasoning — '' once it reported any — and how long it took to reach its answer. */
  thought: string | null = null;
  thinkingMs: number | null = null;
  /** What the provider counted, when it did; and when the first piece of anything arrived. */
  countedInput: number | null = null;
  countedOutput: number | null = null;
  firstTokenMs: number | null = null;
  done = false;
  /** The clock it was given, for the sentence that says it ran out. */
  minutes = 10;
  #seq = 0;
  #listeners = new Set<(event: JobEvent) => void>();

  /** `estimatedInput` is what the request was reckoned to carry, for when the provider counts nothing. */
  constructor(readonly conversationId: string, readonly assistantId: string, readonly persist: Persist | null, readonly estimatedInput = 0) {}

  /** The cost and speed of the response so far: the provider's counts, or estimates said to be such. */
  usage(): Usage {
    const counted = this.countedOutput !== null;
    return {
      input_tokens: this.countedInput ?? this.estimatedInput,
      output_tokens: counted ? this.countedOutput : estimateTokens(this.content) + (this.thought ? estimateTokens(this.thought) : 0),
      tokens_estimated: !counted || this.countedInput === null,
      first_token_ms: this.firstTokenMs, duration_ms: Date.now() - this.startedAt
    };
  }

  get seq() { return this.#seq; }
  abort() { this.controller.abort(); }

  /**
   * Hear everything after `after` — what was already said, then what comes —
   * ending with the verdict. Returns a way to stop listening; a job already
   * done replays and returns at once.
   */
  subscribe(after: number, listener: (event: JobEvent) => void): () => void {
    for (const event of this.events) if (event.seq > after) listener(event);
    if (this.done) return () => {};
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  #emit(event: Said) {
    const numbered = { ...event, seq: ++this.#seq } as JobEvent;
    this.events.push(numbered);
    for (const listener of this.#listeners) listener(numbered);
  }

  /**
   * Write the response: read the model's pieces, checkpoint once a second,
   * and finish with a verdict — complete, cancelled, or failed with a sentence
   * saying why. Never throws; whoever waits for the job hears the verdict as
   * its last event. `timeout` is the signal that says the response ran too long.
   */
  async run(source: AsyncIterable<Piece>, signal: AbortSignal, timeout: AbortSignal, minutes = 10): Promise<void> {
    this.minutes = minutes;
    let status: MessageStatus = 'complete';
    let failure: string | undefined;
    let checkpoint = Date.now();
    const { persist } = this;
    try {
      for await (const piece of source) {
        signal.throwIfAborted();
        if (piece.kind === 'usage') {
          if (piece.input !== null) this.countedInput = piece.input;
          if (piece.output !== null) this.countedOutput = piece.output;
          continue;
        }
        if (this.firstTokenMs === null) this.firstTokenMs = Date.now() - this.startedAt;
        if (piece.kind === 'thinking') {
          if (this.thought === null) this.thought = '';
          if (this.thought.length + piece.text.length <= MAX_CHARS) this.thought += piece.text;
          this.#emit({ type: 'thinking', text: piece.text });
        } else {
          if (this.thought !== null && this.thinkingMs === null) this.thinkingMs = Date.now() - this.startedAt;
          if (this.content.length + piece.text.length > MAX_CHARS) throw new ProviderError(`The response exceeded the size limit.${persist ? ' The partial response was saved.' : ''}`);
          this.content += piece.text;
          this.#emit({ type: 'delta', text: piece.text });
        }
        if (persist && Date.now() - checkpoint >= 1000) {
          await persist.checkpoint(this.content, this.thought);
          checkpoint = Date.now();
        }
      }
      signal.throwIfAborted();
      if (!this.content.trim()) throw new ProviderError('The model returned no text. This release supports text responses only.');
    } catch (err) {
      status = signal.aborted && !timeout.aborted ? 'cancelled' : 'failed';
      failure = timeout.aborted ? `The response was stopped after ${this.minutes} minutes, the limit in Settings › Chat.`
        : status === 'cancelled' ? (persist ? 'Response stopped. Any partial text was saved.' : 'Response stopped.')
        : err instanceof ProviderError ? err.message : 'Could not finish the response. Check the provider connection and database.';
    }
    if (this.thought !== null && this.thinkingMs === null) this.thinkingMs = Date.now() - this.startedAt;
    const usage = this.usage();
    const release = () => { if (activeRuns.get(this.conversationId) === this) activeRuns.delete(this.conversationId); };
    try {
      if (persist) await persist.finish(this.content, status, failure, this.thought, this.thinkingMs, usage);
      // Out of the registry before the verdict goes out: once the row says how
      // it ended, there is nothing being written to join.
      release();
      this.#emit({ type: 'done', status, error: failure, usage, ...(this.thinkingMs !== null ? { thinking_ms: this.thinkingMs } : {}) });
    } catch {
      console.error('Failed to persist response', this.assistantId);
      release();
      this.#emit({ type: 'error', error: 'The response could not be saved. Reload before continuing.' });
    } finally {
      this.done = true;
      this.#listeners.clear();
      release();
    }
  }
}

/** The jobs being written, one per conversation. The DB enforces the same, one streaming message at a time. */
export const activeRuns = new Map<string, Job>();

/**
 * A job as an SSE body: `lead` first, then the job's events after `after`,
 * a heartbeat every fifteen seconds so a proxy does not give up during a
 * model's thinking time, and the stream closes with the verdict. `oncancel`
 * hears the browser going away.
 */
export function jobStream(job: Job, after: number, lead: ChatEvent[] = [], oncancel?: () => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  return new ReadableStream<Uint8Array>({
    start(sink) {
      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try { sink.close(); } catch { /* already gone */ }
      };
      const emit = (event: ChatEvent) => {
        if (closed) return;
        try { sink.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); }
        catch { finish(); }
      };
      for (const event of lead) emit(event);
      heartbeat = setInterval(() => {
        if (closed) return;
        try { sink.enqueue(encoder.encode(': heartbeat\n\n')); }
        catch { finish(); }
      }, 15_000);
      unsubscribe = job.subscribe(after, event => {
        emit(event);
        if (event.type === 'done' || event.type === 'error') finish();
      });
      if (job.done) finish();
    },
    cancel() {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      oncancel?.();
    }
  });
}
