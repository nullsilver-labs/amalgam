import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { activeRuns, jobStream } from '$lib/server/runs';
import { requireScope } from '$lib/server/auth';
import { sse } from '$lib/server/http';

/*
 * Listen again to a response being written. A browser that lost its
 * connection asks for everything after the last event it heard; one that
 * opens the conversation afresh — a reload, another tab, another device —
 * asks with no `after` and is given a snapshot of what has been said, then
 * the rest as it comes. No job means there is nothing to hear: the row
 * says how the response ended, and reading the conversation shows it.
 */
const query = z.object({
  conversationId: z.string().uuid(),
  after: z.coerce.number().int().min(0).optional()
});

export async function GET(event: import('./$types').RequestEvent) {
  requireScope(event, 'read');
  const params = query.safeParse(Object.fromEntries(event.url.searchParams));
  if (!params.success) error(400, 'Invalid request');
  const { conversationId, after } = params.data;
  const job = activeRuns.get(conversationId);
  // A claim without rows yet, or a ghost's job, is nothing to join.
  if (!job || !job.assistantId || !job.persist) error(404, 'No response is being written for this conversation.');
  if (after !== undefined) return sse(jobStream(job, after));
  const seq = job.seq;
  return sse(jobStream(job, seq, [{
    type: 'snapshot', content: job.content, thinking: job.thought, thinking_ms: job.thinkingMs, seq, elapsed_ms: Date.now() - job.startedAt
  }]));
}
