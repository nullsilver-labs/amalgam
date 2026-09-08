import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { database } from '$lib/server/db';
import { requireScope } from '$lib/server/auth';
import { counted, knownZone, periodStart, USAGE_PERIODS } from '$lib/server/usage';
import type { UsageSummary } from '$lib/types';

/*
 * What this instance has sent and received, counted from the rows it kept.
 * Counts are the provider's own where it reported them and estimates where it
 * did not — `tokens_estimated` says which, and the summary carries how many of
 * the responses are of the second kind rather than quietly mixing them. A ghost
 * chat is written nowhere, so it counts nowhere; and none of this is a bill,
 * only what went over the wire.
 */

const period = z.enum(USAGE_PERIODS as [UsageSummary['period'], ...UsageSummary['period'][]]);
/** Enough models to name every one an instance actually uses, and a ceiling all the same. */
const MODELS = 50;

export async function GET(event: import('./$types').RequestEvent) {
  requireScope(event, 'read');
  const parsed = period.safeParse(event.url.searchParams.get('period') ?? 'month');
  if (!parsed.success) error(400, 'Unknown period');
  const start = periodStart(parsed.data, new Date(), knownZone(event.url.searchParams.get('tz')));
  const params = start ? [start.toISOString()] : [];
  // The partial index over created_at covers exactly this predicate.
  const where = `role = 'assistant' AND output_tokens IS NOT NULL${start ? ' AND created_at >= $1' : ''}`;
  const sums = 'count(*) AS responses, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens';
  const db = await database();
  const totals = await db.query(
    `SELECT ${sums}, count(*) FILTER (WHERE tokens_estimated) AS estimated FROM messages WHERE ${where}`, params
  );
  const models = await db.query(
    `SELECT model, ${sums} FROM messages WHERE ${where} AND model IS NOT NULL
     GROUP BY model ORDER BY COALESCE(SUM(output_tokens), 0) DESC, model ASC LIMIT ${MODELS}`, params
  );
  const row = totals.rows[0] ?? {};
  const summary: UsageSummary = {
    period: parsed.data,
    since: start ? start.toISOString() : null,
    responses: counted(row.responses),
    input_tokens: counted(row.input_tokens),
    output_tokens: counted(row.output_tokens),
    estimated: counted(row.estimated),
    models: models.rows.map(m => ({
      model: String(m.model),
      responses: counted(m.responses),
      input_tokens: counted(m.input_tokens),
      output_tokens: counted(m.output_tokens)
    }))
  };
  return json(summary);
}
