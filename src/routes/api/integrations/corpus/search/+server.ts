import { env } from '$env/dynamic/private';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { body } from '$lib/server/http';
import { requireScope } from '$lib/server/auth';
import { corpusConfig, search } from '$lib/server/corpus';

/*
 * Searching the owner's library from the composer. The browser sends a query
 * and gets back rows it can draw; it never sees CORPUS_TOKEN, corpus's address
 * beyond its host, or one byte of corpus's own response — every field below was
 * copied out and bounded by the connector first.
 *
 * An upstream failure is not an error here. It is an answer with a state and a
 * sentence, so the dialog can say "your library refused this token" instead of
 * "something went wrong".
 */

const inputSchema = z.object({
  q: z.string().trim().min(1, 'Type something to search for').max(200),
  limit: z.number().int().min(1).max(20).default(10)
});

export async function POST(event: import('./$types').RequestEvent) {
  requireScope(event, 'read');
  const input = await body(event.request, inputSchema);
  const config = corpusConfig(env);
  if (!config.configured) {
    error(503, config.problem?.detail || 'The corpus connector is not configured on this server.');
  }
  const result = await search(config, input.q, input.limit);
  return json(result);
}
