import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { error } from '@sveltejs/kit';
import type pg from 'pg';

/*
 * Who is asking, and what they are allowed to do.
 *
 * Two kinds of credential reach this app, and they are deliberately not the
 * same thing. A browser session is the owner sitting at a keyboard: it is a
 * row in the database, revocable one device at a time, and it carries every
 * scope. An integration token is a named key handed to a script: it carries
 * only the scopes it was created with, it is accepted on /api/* alone, and it
 * can never create a session, touch a session, or mint another token. That
 * asymmetry is the whole point — a leaked automation key must not be able to
 * turn itself into a login.
 *
 * Only SHA-256 hashes of secrets are stored. The plaintext exists once, in the
 * response that created it, and then never again.
 */

export const SESSION_COOKIE = 'amalgam_session';
export const SESSION_SECONDS = 60 * 60 * 24 * 7;
/** How stale last_seen_at may get before a request pays for an update. */
export const TOUCH_INTERVAL_SECONDS = 60;

export type Scope = 'read' | 'write' | 'generate' | 'admin';
export const SCOPES: Scope[] = ['read', 'write', 'generate', 'admin'];

/** The caller of a request, once a credential has been recognised. */
export interface Principal {
  kind: 'session' | 'token';
  id: string;
  /** The device label of a session, or the name of a token. */
  name: string;
  scopes: Scope[];
}

export interface SessionRow {
  id: string; device: string; created_at: string; last_seen_at: string; expires_at: string;
}

type Queryable = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;

/** Constant-time comparison over digests, so neither length nor content leaks through timing. */
export function equalSecret(a: string, b: string) {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

/** 256 bits of randomness, in the shortest form that survives a copy and paste. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/*
 * A short, honest name for the device holding a session — "Chrome on Linux",
 * "Safari on iPhone" — so the Devices list is readable without asking the
 * browser anything. User-Agent strings lie about each other by design (every
 * browser claims to be Mozilla, Chromium browsers claim to be Safari), so the
 * order below matters: the most specific token that is present wins. This is a
 * label, never a security decision.
 */
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bVivaldi\//, 'Vivaldi'],
  [/\bBrave\//, 'Brave'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bCriOS\/|\bChrome\/|\bChromium\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
  [/\bcurl\//, 'curl']
];
const PLATFORMS: [RegExp, string][] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b|\bX11\b/, 'Linux']
];

export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = (userAgent || '').slice(0, 500);
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1];
  const platform = PLATFORMS.find(([pattern]) => pattern.test(ua))?.[1];
  if (browser && platform) return `${browser} on ${platform}`;
  return browser || platform || 'Unknown browser';
}

/* ------------------------------------------------------------------
 * Sessions
 * ---------------------------------------------------------------- */

/** Create a signed-in device. The returned secret is the cookie value and is never stored. */
export async function createSession(db: Queryable, device: string): Promise<{ id: string; secret: string }> {
  const id = randomUUID();
  const secret = newSecret();
  await db.query(
    `INSERT INTO sessions(id, secret_hash, device, expires_at) VALUES($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
    [id, hashSecret(secret), device, String(SESSION_SECONDS)]
  );
  return { id, secret };
}

/**
 * Resolve a cookie to its session. One SELECT per request; the row's
 * last_seen_at is refreshed only when it has gone stale, so an active browser
 * writes about once a minute rather than on every keystroke's worth of fetches.
 */
export async function sessionFromCookie(db: Queryable, cookie: string | undefined): Promise<Principal | null> {
  if (!cookie) return null;
  const row = (await db.query(
    `SELECT id, device, last_seen_at < now() - ($2 || ' seconds')::interval AS stale
       FROM sessions WHERE secret_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [hashSecret(cookie), String(TOUCH_INTERVAL_SECONDS)]
  )).rows[0];
  if (!row) return null;
  if (row.stale) await db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.id]);
  return { kind: 'session', id: row.id, name: row.device, scopes: [...SCOPES] };
}

export async function listSessions(db: Queryable): Promise<SessionRow[]> {
  return (await db.query(
    `SELECT id, device, created_at, last_seen_at, expires_at FROM sessions
      WHERE revoked_at IS NULL AND expires_at > now() ORDER BY created_at`
  )).rows;
}

/** Revoke one live session. False when it was already gone. */
export async function revokeSession(db: Queryable, id: string): Promise<boolean> {
  const result = await db.query(
    'UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()', [id]
  );
  return Boolean(result.rowCount);
}

/**
 * Every session ends. Used when APP_PASSWORD changes: the promise that a new
 * password locks out old browsers has to be kept by the database now that
 * sessions no longer derive from the password itself.
 */
export async function revokeAllSessions(db: Queryable): Promise<number> {
  const result = await db.query('UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL');
  return result.rowCount || 0;
}

/* ------------------------------------------------------------------
 * Authorisation
 * ---------------------------------------------------------------- */

export function hasScope(principal: Principal | null, scope: Scope): boolean {
  return Boolean(principal && principal.scopes.includes(scope));
}

/**
 * The one gate every API route passes through. Missing credential is 401 —
 * hooks.server.ts has usually answered that already — and a credential that
 * simply is not allowed to do this is 403, which is the difference an
 * integration author needs to see.
 */
export function requireScope(event: { locals: App.Locals }, scope: Scope): Principal {
  const principal = event.locals.principal;
  if (!principal) error(401, 'Please sign in again.');
  if (!principal.scopes.includes(scope)) {
    error(403, `This token does not have the "${scope}" scope.`);
  }
  return principal;
}

/** For the routes that manage credentials themselves: a browser session, never a token. */
export function requireSession(event: { locals: App.Locals }): Principal {
  const principal = event.locals.principal;
  if (!principal) error(401, 'Please sign in again.');
  if (principal.kind !== 'session') error(403, 'Only a signed-in browser can manage devices and tokens.');
  return principal;
}
