import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { database } from '$lib/server/db';
import { requireScope } from '$lib/server/auth';

/** How many conversations one page of the archive holds. */
const PAGE = 200;
// The archive is walked by keyset, not by offset: a page asks for what sits
// after the last row it was given, so a conversation moving up the list while
// someone reads cannot hide a row or repeat one. `id` breaks ties on the
// timestamp, which is why both travel together. The browser only ever sees
// timestamps to the millisecond, so the order is kept at that grain too, or
// a row a few microseconds behind the cursor would fall between two pages.
const cursor = z.object({ before: z.string().datetime({ offset: true }), beforeId: z.string().uuid() });
const RECENT = "date_trunc('milliseconds', updated_at) DESC, id DESC";

export async function GET(event: import('./$types').RequestEvent) {
  requireScope(event, 'read');
  const { url } = event;
  const query = (url.searchParams.get('q') || '').slice(0, 200);
  const db = await database();
  if (query) {
    const result = await db.query(
      `SELECT c.* FROM conversations c WHERE c.title ILIKE '%' || $1 || '%'
       OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content ILIKE '%' || $1 || '%')
       ORDER BY updated_at DESC LIMIT ${PAGE}`, [query]
    );
    return json(result.rows);
  }
  const before = url.searchParams.get('before'), beforeId = url.searchParams.get('beforeId');
  if (before === null && beforeId === null) {
    const result = await db.query(`SELECT * FROM conversations ORDER BY ${RECENT} LIMIT ${PAGE}`);
    return json(result.rows);
  }
  const parsed = cursor.safeParse({ before, beforeId });
  if (!parsed.success) error(400, 'Invalid cursor');
  const result = await db.query(
    // Cast both sides: a row comparison gives the driver nothing to infer the
    // parameter types from.
    `SELECT * FROM conversations WHERE (date_trunc('milliseconds', updated_at), id) < ($1::timestamptz, $2::uuid)
     ORDER BY ${RECENT} LIMIT ${PAGE}`, [parsed.data.before, parsed.data.beforeId]
  );
  return json(result.rows);
}
