import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { body } from '$lib/server/http';
import { database } from '$lib/server/db';
import { createSession, deviceLabel, equalSecret, SESSION_COOKIE, SESSION_SECONDS } from '$lib/server/auth';
// Single-user, bounded global throttle: no untrusted forwarded-IP map or unbounded allocations.
let attempts = 0;
let windowEnd = 0;
export async function POST({ request, cookies }: import('./$types').RequestEvent) {
  if (Date.now() > windowEnd) { attempts = 0; windowEnd = Date.now() + 60_000; }
  if (++attempts > 10) return json({ error: 'Too many attempts. Try again in one minute.' }, { status: 429 });
  const { password } = await body(request, z.object({ password: z.string().max(1024) }));
  if (!equalSecret(password, env.APP_PASSWORD || '')) return json({ error: 'Incorrect password.' }, { status: 401 });
  // The cookie is a row's secret now, so signing in is a write. The device
  // label is only what the browser said about itself, kept short and readable.
  const { secret } = await createSession(await database(), deviceLabel(request.headers.get('user-agent')));
  cookies.set(SESSION_COOKIE, secret, {
    path: '/', httpOnly: true, sameSite: 'strict', secure: env.ORIGIN?.startsWith('https://') ?? false,
    maxAge: SESSION_SECONDS
  });
  return json({ ok: true });
}
