import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { database } from '$lib/server/db';
import { requireSession } from '$lib/server/auth';
import { revokeToken } from '$lib/server/tokens';
import type { RequestEvent } from './$types';
/** Revoke one integration token. Session only, like creating one. */
export async function DELETE(event: RequestEvent) {
  requireSession(event);
  if (!z.string().uuid().safeParse(event.params.id).success) error(400, 'Invalid token ID');
  if (!(await revokeToken(await database(), event.params.id))) error(404, 'That token is already revoked.');
  return json({ ok: true });
}
