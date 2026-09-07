import { createHash } from 'node:crypto';
import { env } from '$env/dynamic/private';
import pg from 'pg';
import schema from './schema.sql?raw';
let pool: pg.Pool | undefined;
let initialization: Promise<void> | undefined;
export async function database(): Promise<pg.Pool> {
  if (!pool) {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 8, connectionTimeoutMillis: 5000 });
    pool.on('error', () => console.error('Database connection interrupted'));
  }
  if (!initialization) initialization = initialize(pool).catch(error => { initialization = undefined; throw error; });
  await initialization;
  return pool;
}
async function initialize(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(879001)');
    await client.query(schema);
    // This release deliberately supports one application instance, not replicas.
    await client.query("UPDATE messages SET status='interrupted', error='The server restarted before this response finished.' WHERE status='streaming'");
    await checkPassword(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
/*
 * Sessions used to be HMACs of APP_PASSWORD, so changing the password broke
 * them by construction. They are rows now, which is better in every way except
 * that: nothing about a row cares what the password is. So the instance
 * remembers a fingerprint of the password it last started with, and when that
 * changes every session ends. Only a SHA-256 is stored, and it is compared
 * against nothing a request supplies, so it reveals no more than the fact that
 * the password was rotated.
 */
async function checkPassword(client: pg.PoolClient) {
  const password = env.APP_PASSWORD;
  if (!password) return;
  const fingerprint = createHash('sha256').update(password).digest('hex');
  const stored = (await client.query("SELECT value FROM settings WHERE key='password_fingerprint'")).rows[0]?.value;
  if (stored === fingerprint) return;
  if (stored) {
    const revoked = await client.query('UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL');
    console.log(`APP_PASSWORD changed: ${revoked.rowCount || 0} signed-in device(s) signed out.`);
  }
  await client.query(
    `INSERT INTO settings(key, value) VALUES('password_fingerprint', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(fingerprint)]
  );
}
