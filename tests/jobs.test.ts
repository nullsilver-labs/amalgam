import { describe, expect, it } from 'vitest';
import { Job, activeRuns, jobStream, type JobEvent } from '../src/lib/server/runs';
import type { Piece } from '../src/lib/server/providers';
import { eventData } from '../src/lib/sse';

/*
 * A response is the server's to finish. These pin what that means for the
 * job that writes it: every event is numbered and kept, a listener who
 * arrives late hears what was said, one who asks after a number hears only
 * what followed, the row is written as it goes, and stopping is a verdict.
 */

const CHAT = '11111111-1111-4111-8111-111111111111';

/** Pieces handed out one per turn of the event loop, so listeners can join between them. */
async function* pieces(list: Piece[], gate?: { pause: Promise<void> }): AsyncGenerator<Piece> {
  for (const piece of list) {
    await new Promise(resolve => setTimeout(resolve, 1));
    if (gate) await gate.pause;
    yield piece;
  }
}
const say = (text: string): Piece => ({ kind: 'text', text });
const think = (text: string): Piece => ({ kind: 'thinking', text });

function recorder() {
  const checkpoints: string[] = [];
  const finished: unknown[][] = [];
  return {
    checkpoints, finished,
    persist: {
      checkpoint: async (content: string) => { checkpoints.push(content); },
      finish: async (...args: unknown[]) => { finished.push(args); }
    }
  };
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for await (const data of eventData(stream)) out.push(JSON.parse(data));
  return out;
}

describe('a job', () => {
  it('numbers what it says, replays it to a late listener, and hands a numbered listener only what followed', async () => {
    const { persist, finished } = recorder();
    const job = new Job(CHAT, 'a1', persist);
    activeRuns.set(CHAT, job);
    const timeout = AbortSignal.timeout(10_000);
    const run = job.run(pieces([think('hm'), say('one'), say(' two'), say(' three')]), AbortSignal.any([job.controller.signal, timeout]), timeout);
    const early: JobEvent[] = [];
    job.subscribe(0, e => early.push(e));
    await run;
    expect(early.map(e => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(early.at(-1)).toMatchObject({ type: 'done', status: 'complete', seq: 5 });
    expect(job.content).toBe('one two three');
    expect(job.thought).toBe('hm');
    expect(job.thinkingMs).not.toBeNull();
    expect(finished).toHaveLength(1);
    expect(finished[0].slice(0, 5)).toEqual(['one two three', 'complete', undefined, 'hm', job.thinkingMs]);
    expect(finished[0][5]).toMatchObject({ tokens_estimated: true });
    // Done and gone from the registry, but still answering to anyone who asks.
    expect(activeRuns.has(CHAT)).toBe(false);
    const late: JobEvent[] = [];
    job.subscribe(0, e => late.push(e));
    expect(late).toEqual(early);
    const after: JobEvent[] = [];
    job.subscribe(3, e => after.push(e));
    expect(after.map(e => e.seq)).toEqual([4, 5]);
  });

  it('is stopped by its controller with a cancelled verdict, and the partial text is what is saved', async () => {
    const { persist, finished } = recorder();
    const job = new Job(CHAT, 'a1', persist);
    const timeout = AbortSignal.timeout(10_000);
    const signal = AbortSignal.any([job.controller.signal, timeout]);
    let count = 0;
    async function* endless(): AsyncGenerator<Piece> {
      while (true) { await new Promise(resolve => setTimeout(resolve, 2)); yield say(`${count++} `); }
    }
    const run = job.run(endless(), signal, timeout);
    await new Promise(resolve => setTimeout(resolve, 30));
    job.abort();
    await run;
    expect(job.done).toBe(true);
    const verdict = job.events.at(-1);
    expect(verdict).toMatchObject({ type: 'done', status: 'cancelled', error: 'Response stopped. Any partial text was saved.' });
    expect(finished[0].slice(0, 5)).toEqual([job.content, 'cancelled', 'Response stopped. Any partial text was saved.', null, null]);
    expect(job.content.length).toBeGreaterThan(0);
  });

  it('streams a lead, then its events, and keeps going for a listener whose stream was cancelled', async () => {
    const { persist } = recorder();
    const job = new Job(CHAT, 'a1', persist);
    const timeout = AbortSignal.timeout(10_000);
    let release!: () => void;
    const gate = { pause: new Promise<void>(resolve => { release = resolve; }) };
    const run = job.run(pieces([say('first'), say(' second')], gate), AbortSignal.any([job.controller.signal, timeout]), timeout);
    // One listener goes away before anything is said. The job does not notice.
    let cancelled = false;
    const first = jobStream(job, 0, [{ type: 'delta', text: 'lead' }], () => { cancelled = true; });
    await first.cancel();
    expect(cancelled).toBe(true);
    release();
    await run;
    const heard = await drain(jobStream(job, 0));
    expect(heard.map(e => e.type)).toEqual(['delta', 'delta', 'done']);
    expect(heard.map(e => e.seq)).toEqual([1, 2, 3]);
    const rest = await drain(jobStream(job, 1, [{ type: 'snapshot', content: job.content, thinking: null, thinking_ms: null, seq: 1, elapsed_ms: 0 }]));
    expect(rest.map(e => e.type)).toEqual(['snapshot', 'delta', 'done']);
  });

  it('keeps the provider\'s count, times the reply, and estimates in so many words when nothing was counted', async () => {
    const { persist, finished } = recorder();
    const counted = new Job(CHAT, 'a1', persist, 500);
    const timeout = AbortSignal.timeout(10_000);
    await counted.run(pieces([say('one two'), { kind: 'usage', input: 42, output: 7 }]), AbortSignal.any([counted.controller.signal, timeout]), timeout, 3);
    const usage = counted.usage();
    expect(usage).toMatchObject({ input_tokens: 42, output_tokens: 7, tokens_estimated: false });
    expect(usage.first_token_ms).not.toBeNull();
    expect(usage.duration_ms).toBeGreaterThanOrEqual(usage.first_token_ms!);
    expect(finished[0][5]).toMatchObject({ input_tokens: 42, output_tokens: 7 });
    expect(counted.events.at(-1)).toMatchObject({ type: 'done', usage: { input_tokens: 42, output_tokens: 7, tokens_estimated: false } });
    const reckoned = new Job(CHAT, 'a2', persist, 500);
    await reckoned.run(pieces([think('hmm hmm'), say('one two three four')]), AbortSignal.any([reckoned.controller.signal, timeout]), timeout);
    expect(reckoned.usage()).toMatchObject({ input_tokens: 500, tokens_estimated: true });
    expect(reckoned.usage().output_tokens).toBeGreaterThan(0);
    // Half a count is still an estimate.
    const half = new Job(CHAT, 'a3', persist, 500);
    await half.run(pieces([say('x'), { kind: 'usage', input: null, output: 1 }]), AbortSignal.any([half.controller.signal, timeout]), timeout);
    expect(half.usage()).toMatchObject({ input_tokens: 500, output_tokens: 1, tokens_estimated: true });
  });
  it('names the clock it ran out of', async () => {
    const { persist } = recorder();
    const job = new Job(CHAT, 'a1', persist);
    const timeout = AbortSignal.timeout(20);
    async function* endless(): AsyncGenerator<Piece> {
      while (true) { await new Promise(resolve => setTimeout(resolve, 5)); yield say('. '); }
    }
    await job.run(endless(), AbortSignal.any([job.controller.signal, timeout]), timeout, 7);
    expect(job.events.at(-1)).toMatchObject({ type: 'done', status: 'failed', error: 'The response was stopped after 7 minutes, the limit in Settings › Chat.' });
  });
  it('ends with an error event, never a throw, when the row cannot be written', async () => {
    const job = new Job(CHAT, 'a1', { checkpoint: async () => {}, finish: async () => { throw new Error('db gone'); } });
    const timeout = AbortSignal.timeout(10_000);
    await job.run(pieces([say('x')]), AbortSignal.any([job.controller.signal, timeout]), timeout);
    expect(job.events.at(-1)).toMatchObject({ type: 'error', seq: 2 });
    expect(job.done).toBe(true);
  });
});
