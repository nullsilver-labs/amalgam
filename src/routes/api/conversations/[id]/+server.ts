import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { database } from '$lib/server/db';
import { body } from '$lib/server/http';
import { activeRuns } from '$lib/server/runs';
import { requireScope } from '$lib/server/auth';
import type { RequestEvent } from './$types';
function idOf(params: RequestEvent['params']) {
  if (!z.string().uuid().safeParse(params.id).success) error(400, 'Invalid conversation ID');
  return params.id;
}
export async function GET(event: RequestEvent) {
  requireScope(event, 'read');
  const id = idOf(event.params), db = await database();
  const conversation = (await db.query('SELECT * FROM conversations WHERE id=$1', [id])).rows[0];
  if (!conversation) error(404, 'Conversation not found');
  // Recover a stranded marker after a final persistence failure, without touching a live run.
  if (!activeRuns.has(id)) await db.query("UPDATE messages SET status='interrupted', error='The response was interrupted. Saved partial text is shown.' WHERE conversation_id=$1 AND status='streaming'", [id]);
  // Every branch, in the order it was written; the conversation's leaf_id says which one was open.
  const messages = (await db.query('SELECT id, conversation_id, role, content, status, model, error, context_manifest, sources, parent_id, thinking, thinking_ms, input_tokens, output_tokens, tokens_estimated, first_token_ms, duration_ms, created_at FROM messages WHERE conversation_id=$1 ORDER BY position', [id])).rows;
  return json({ conversation, messages });
}
export async function PATCH(event: RequestEvent) {
  requireScope(event, 'write');
  const { params, request } = event;
  const id = idOf(params), db = await database();
  // A title, or the leaf now being read. Reading a branch is not an edit, so
  // only the title moves the conversation up the list.
  const input = await body(request, z.object({ title: z.string().trim().min(1).max(120).optional(), leafId: z.string().uuid().optional() })
    .refine(v => v.title !== undefined || v.leafId !== undefined, { message: 'Nothing to change' }));
  if (input.leafId && !(await db.query('SELECT 1 FROM messages WHERE id=$1 AND conversation_id=$2', [input.leafId, id])).rowCount) error(404, 'That message is not in this conversation');
  const result = input.title !== undefined
    ? await db.query('UPDATE conversations SET title=$2, updated_at=now(), leaf_id=COALESCE($3, leaf_id) WHERE id=$1 RETURNING *', [id, input.title, input.leafId ?? null])
    : await db.query('UPDATE conversations SET leaf_id=$2 WHERE id=$1 RETURNING *', [id, input.leafId]);
  if (!result.rowCount) error(404, 'Conversation not found');
  return json(result.rows[0]);
}
export async function DELETE(event: RequestEvent) {
  requireScope(event, 'write');
  const id = idOf(event.params);
  const db = await database();
  // A row lock serializes deletion with starting a generation.
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE', [id]);
    if ((await client.query("SELECT 1 FROM messages WHERE conversation_id=$1 AND status='streaming'", [id])).rowCount || activeRuns.has(id)) {
      error(409, 'Stop the response before deleting this conversation');
    }
    await client.query('DELETE FROM conversations WHERE id=$1', [id]);
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
  return json({ ok: true });
}
