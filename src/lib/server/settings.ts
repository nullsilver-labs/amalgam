import type pg from 'pg';
import { z } from 'zod';
import { DEFAULT_CONTEXT_TOKENS, DEFAULT_SETTINGS, type ChatSettings } from '../types';

/*
 * Instance-wide chat settings: the system prompt, the context budget and
 * the new-chat suggestions. One jsonb row; validated on the way in and on the way out,
 * so a hand-edited or older row can never break a request.
 */

export const chatSettingsSchema = z.object({
  systemPrompt: z.string().max(12000),
  // Defaulted, so a row saved before the budget existed still reads whole.
  contextTokens: z.number().int().min(1000).max(2_000_000).default(DEFAULT_CONTEXT_TOKENS),
  thinking: z.boolean().default(true),
  suggestions: z.array(z.object({ label: z.string().trim().min(1).max(40), text: z.string().max(2000) })).max(8)
});

type Queryable = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;

export async function readSettings(db: Queryable): Promise<ChatSettings> {
  const row = (await db.query("SELECT value FROM settings WHERE key='chat'")).rows[0];
  if (!row) return DEFAULT_SETTINGS;
  const parsed = chatSettingsSchema.safeParse(row.value);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function writeSettings(db: Queryable, value: ChatSettings): Promise<void> {
  await db.query(
    "INSERT INTO settings(key, value) VALUES('chat', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    [JSON.stringify(value)]
  );
}
