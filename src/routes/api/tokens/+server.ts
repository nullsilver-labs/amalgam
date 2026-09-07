import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { database } from '$lib/server/db';
import { body } from '$lib/server/http';
import { requireSession, SCOPES } from '$lib/server/auth';
import { createToken, EXPIRY_CHOICES, listTokens } from '$lib/server/tokens';

/*
 * Integration tokens are created and revoked by the owner in a browser and by
 * nobody else — a token cannot mint another token, which is what keeps one
 * leaked key from becoming a permanent foothold. The secret is returned here
 * once and never again; the database holds only its hash.
 */

const input = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(z.enum(SCOPES as [string, ...string[]])).min(1).max(SCOPES.length),
  expiresInDays: z.union([z.literal(EXPIRY_CHOICES[0]), z.literal(EXPIRY_CHOICES[1]), z.literal(EXPIRY_CHOICES[2]), z.null()]).default(null)
});

export async function GET(event: import('./$types').RequestEvent) {
  requireSession(event);
  return json(await listTokens(await database()));
}

export async function POST(event: import('./$types').RequestEvent) {
  requireSession(event);
  const value = await body(event.request, input);
  const scopes = [...new Set(value.scopes)].filter((s): s is (typeof SCOPES)[number] => SCOPES.includes(s as never));
  const { token, secret } = await createToken(await database(), value.name, scopes, value.expiresInDays);
  return json({ ...token, secret }, { status: 201 });
}
