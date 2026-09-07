import { json } from '@sveltejs/kit';
import { database } from '$lib/server/db';
import { listSessions, requireSession } from '$lib/server/auth';
/** The devices signed in to this instance. Session only — a token never sees them. */
export async function GET(event: import('./$types').RequestEvent) {
  const current = requireSession(event);
  const rows = await listSessions(await database());
  return json(rows.map(row => ({ ...row, current: row.id === current.id })));
}
