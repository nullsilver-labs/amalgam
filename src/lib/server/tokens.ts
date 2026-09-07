import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { hashSecret, newSecret, SCOPES, TOUCH_INTERVAL_SECONDS, type Principal, type Scope } from './auth';

/*
 * Integration tokens: named bearer keys for scripts, each revocable on its own,
 * each carrying only the scopes it was given. The prefix makes one recognisable
 * in a log or a leaked file, and the rest is 256 bits of randomness. Only the
 * SHA-256 of the whole presented string is stored, so a database dump does not
 * hand anyone a working key.
 *
 * A token is never the owner. It cannot sign in, cannot list or revoke devices,
 * and cannot create another token — those routes ask for a browser session.
 */

export const TOKEN_PREFIX = 'amg_';
/** The choices Settings offers. Anything else the API would accept is not exposed. */
export const EXPIRY_CHOICES = [30, 90, 365] as const;

export interface TokenRow {
  id: string; name: string; scopes: Scope[];
  created_at: string; last_used_at: string | null; expires_at: string | null;
}

type Queryable = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;

export function isScope(value: unknown): value is Scope {
  return typeof value === 'string' && (SCOPES as string[]).includes(value);
}

export async function createToken(
  db: Queryable, name: string, scopes: Scope[], expiresInDays: number | null
): Promise<{ token: TokenRow; secret: string }> {
  const id = randomUUID();
  const secret = TOKEN_PREFIX + newSecret();
  const row = (await db.query(
    `INSERT INTO api_tokens(id, name, secret_hash, scopes, expires_at)
     VALUES($1, $2, $3, $4, CASE WHEN $5::int IS NULL THEN NULL ELSE now() + ($5 || ' days')::interval END)
     RETURNING id, name, scopes, created_at, last_used_at, expires_at`,
    [id, name, hashSecret(secret), scopes, expiresInDays]
  )).rows[0];
  return { token: row, secret };
}

/**
 * Recognise a presented bearer string. An expired or revoked token is simply
 * not a token — the caller answers 401 either way, so the difference between
 * "never existed" and "no longer valid" is not published.
 */
export async function tokenFromBearer(db: Queryable, presented: string | undefined): Promise<Principal | null> {
  if (!presented || !presented.startsWith(TOKEN_PREFIX)) return null;
  const row = (await db.query(
    `SELECT id, name, scopes, (last_used_at IS NULL OR last_used_at < now() - ($2 || ' seconds')::interval) AS stale
       FROM api_tokens
      WHERE secret_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [hashSecret(presented), String(TOUCH_INTERVAL_SECONDS)]
  )).rows[0];
  if (!row) return null;
  if (row.stale) await db.query('UPDATE api_tokens SET last_used_at = now() WHERE id = $1', [row.id]);
  return { kind: 'token', id: row.id, name: row.name, scopes: (row.scopes as string[]).filter(isScope) };
}

export async function listTokens(db: Queryable): Promise<TokenRow[]> {
  return (await db.query(
    `SELECT id, name, scopes, created_at, last_used_at, expires_at FROM api_tokens
      WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at`
  )).rows;
}

export async function revokeToken(db: Queryable, id: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE api_tokens SET revoked_at = now()
      WHERE id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`, [id]
  );
  return Boolean(result.rowCount);
}

/** The value of an Authorization header, if it is a bearer one. */
export function bearerFrom(header: string | null): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : undefined;
}
