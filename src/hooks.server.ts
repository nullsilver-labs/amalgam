import { env } from '$env/dynamic/private';
import { json, redirect, type Handle } from '@sveltejs/kit';
import { SESSION_COOKIE, sessionFromCookie } from '$lib/server/auth';
import { bearerFrom, tokenFromBearer } from '$lib/server/tokens';
import { claimedHost, hostingPolicy, peerIsTrusted, privateHttpWarning } from '$lib/server/hosting';
import { database } from '$lib/server/db';

/*
 * The boundary. Everything that decides whether a request is allowed to exist
 * happens here, once, before any route sees it:
 *
 *   1. the address the request claims to have been made to must be ours,
 *   2. the hosting configuration must be one the operator has accepted,
 *   3. an instance password must be set at all,
 *   4. the credential, if any, becomes event.locals.principal,
 *   5. a cookie-authenticated write must come from our own origin,
 *   6. anything not public needs a principal.
 *
 * Scopes are not checked here — a route knows what it needs and says so with
 * requireScope(). This function only establishes who is asking.
 */

const policy = hostingPolicy(env);
if (policy.privateHttp && !policy.problem) console.warn(privateHttpWarning(policy.origin));
if (policy.problem) console.error(`amalgam refuses to serve requests: ${policy.problem}`);

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

export const handle: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;
  const headers = event.request.headers;
  const api = path.startsWith('/api/');

  // Only the socket peer cannot be forged, so it alone decides whether the
  // forwarded headers are worth reading. adapter-node's ADDRESS_HEADER is
  // deliberately left unset so getClientAddress() is the real TCP peer.
  const peerTrusted = peerIsTrusted(event.getClientAddress(), policy.trustedProxies);
  event.locals.peerTrusted = peerTrusted;
  event.locals.principal = null;

  // A configuration the operator has not accepted is refused outright, in the
  // same shape as the missing-password refusal: the message names what to set.
  // /api/health still answers, so an orchestrator can see the container is up.
  if (policy.problem && path !== '/api/health') return new Response(policy.problem, { status: 503 });

  // The adapter's ORIGIN setting is not a Host allowlist; check the claimed host too.
  const claimed = claimedHost(headers, peerTrusted);
  if (claimed.host !== policy.origin.host) return new Response('Unrecognized host', { status: 403 });

  if (path !== '/api/health' && (!env.APP_PASSWORD || env.APP_PASSWORD.length < 16)) {
    return new Response('Set APP_PASSWORD to at least 16 characters in .env, then restart amalgam.', { status: 503 });
  }

  // A bearer token is an /api/* credential only: on a page route it is ignored
  // outright, so a leaked integration key can never be dressed up as a browser.
  const bearer = api ? bearerFrom(headers.get('authorization')) : undefined;
  if (bearer) {
    try { event.locals.principal = await tokenFromBearer(await database(), bearer); }
    catch { return json({ error: 'The database is unavailable.' }, { status: 503 }); }
    if (!event.locals.principal) return json({ error: 'That token is not valid.' }, { status: 401 });
  } else {
    const cookie = event.cookies.get(SESSION_COOKIE);
    if (cookie && path !== '/api/health') {
      try {
        event.locals.principal = await sessionFromCookie(await database(), cookie);
        // Only a definite answer clears the cookie: a database outage must not
        // sign the owner out of a browser whose session is perfectly good.
        if (!event.locals.principal) event.cookies.delete(SESSION_COOKIE, { path: '/' });
      } catch { /* the database is down; the request continues unauthenticated */ }
    }
  }

  /*
   * CSRF, for cookie-carrying requests only. A bearer request is exempt: it
   * proves intent by presenting a secret no other site can read, whereas a
   * cookie rides along whether the page meant it or not. Sec-Fetch-Site is
   * checked when the browser sends it, because it is the one signal a
   * cross-site form post cannot suppress.
   */
  if (!SAFE_METHODS.includes(event.request.method) && event.locals.principal?.kind !== 'token') {
    if (headers.get('origin') !== policy.origin.origin) {
      return new Response('Cross-origin request rejected', { status: 403 });
    }
    const site = headers.get('sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none') {
      return new Response('Cross-origin request rejected', { status: 403 });
    }
  }

  const publicPath = path === '/login' || path === '/api/login' || path === '/api/health';
  if (!publicPath && !event.locals.principal) {
    if (api) return json({ error: 'Please sign in again.' }, { status: 401 });
    redirect(303, '/login');
  }

  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return response;
};
