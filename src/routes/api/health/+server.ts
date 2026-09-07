import { json } from '@sveltejs/kit';
import { database } from '$lib/server/db';
export async function GET() {
  try { await (await database()).query('SELECT 1'); return json({ status: 'ok' }); }
  catch { return json({ status: 'unavailable' }, { status: 503 }); }
}
