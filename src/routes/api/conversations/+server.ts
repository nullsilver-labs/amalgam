import { json } from '@sveltejs/kit';
import { database } from '$lib/server/db';
import { requireScope } from '$lib/server/auth';
export async function GET(event: import('./$types').RequestEvent) {
  requireScope(event, 'read');
  const { url } = event;
  const query = (url.searchParams.get('q') || '').slice(0, 200);
  const result = await (await database()).query(
    `SELECT c.* FROM conversations c WHERE $1 = '' OR c.title ILIKE '%' || $1 || '%'
     OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content ILIKE '%' || $1 || '%')
     ORDER BY updated_at DESC LIMIT 200`, [query]
  );
  return json(result.rows);
}
