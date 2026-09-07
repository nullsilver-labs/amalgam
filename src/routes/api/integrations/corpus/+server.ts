import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { requireScope } from '$lib/server/auth';
import { corpusConfig, probe } from '$lib/server/corpus';
import type { CorpusDiagnostic } from '$lib/types';

/*
 * "Can amalgam read your library, right now?" — asked of corpus, not guessed
 * from configuration. The answer distinguishes an address that does not answer
 * from a token corpus does not know from a token that is known and not allowed,
 * because those are three different evenings for whoever has to fix it.
 *
 * The result is held for half a minute. Settings is a panel people open and
 * close, and a diagnostic that hammers another application every time somebody
 * clicks a tab is a rude neighbour; "Check now" is the way to ask again sooner.
 */

const CACHE_MS = 30_000;
let cached: { at: number; value: CorpusDiagnostic } | null = null;

export async function GET(event: import('./$types').RequestEvent) {
  requireScope(event, 'read');
  const fresh = event.url.searchParams.get('refresh') === '1';
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return json(cached.value);
  const config = corpusConfig(env);
  const diagnosis = await probe(config);
  const value: CorpusDiagnostic = {
    configured: config.configured,
    endpoint: config.endpoint,
    state: diagnosis.state,
    detail: diagnosis.detail,
    checked_at: new Date().toISOString()
  };
  cached = { at: Date.now(), value };
  return json(value);
}
