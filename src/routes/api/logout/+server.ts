import { json } from '@sveltejs/kit';
import { database } from '$lib/server/db';
import { requireSession, revokeSession, SESSION_COOKIE } from '$lib/server/auth';
export async function POST(event: import('./$types').RequestEvent) {
  const { cookies } = event;
  // Signing out is a browser's business: a token has no session to end.
  // Clearing the cookie is not enough now that a session is a row — revoke it,
  // so a copy of the cookie taken elsewhere stops working too.
  await revokeSession(await database(), requireSession(event).id);
  cookies.delete(SESSION_COOKIE, { path: '/' });
  return json({ ok: true });
}
