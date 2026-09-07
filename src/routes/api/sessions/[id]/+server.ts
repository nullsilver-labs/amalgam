import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { database } from '$lib/server/db';
import { requireSession, revokeSession, SESSION_COOKIE } from '$lib/server/auth';
import type { RequestEvent } from './$types';
/** Revoke one device. Revoking your own is signing out, so the cookie goes too. */
export async function DELETE(event: RequestEvent) {
  const current = requireSession(event);
  if (!z.string().uuid().safeParse(event.params.id).success) error(400, 'Invalid session ID');
  if (!(await revokeSession(await database(), event.params.id))) error(404, 'That device is already signed out.');
  if (event.params.id === current.id) event.cookies.delete(SESSION_COOKIE, { path: '/' });
  return json({ ok: true });
}
