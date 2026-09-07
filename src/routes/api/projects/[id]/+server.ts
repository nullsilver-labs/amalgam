import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { database } from '$lib/server/db';
import { body } from '$lib/server/http';
import { requireScope } from '$lib/server/auth';
import type { RequestEvent } from './$types';
const schema = z.object({ name: z.string().trim().min(1).max(100), instructions: z.string().max(12000).default('') });
function idOf(params: RequestEvent['params']) {
  if (!z.string().uuid().safeParse(params.id).success) error(400, 'Invalid project ID');
  return params.id;
}
export async function PATCH(event: RequestEvent) {
  requireScope(event, 'write');
  const input = await body(event.request, schema);
  const result = await (await database()).query('UPDATE projects SET name=$2,instructions=$3 WHERE id=$1 RETURNING *', [idOf(event.params), input.name, input.instructions]);
  if (!result.rowCount) error(404, 'Project not found');
  return json(result.rows[0]);
}
export async function DELETE(event: RequestEvent) {
  requireScope(event, 'write');
  await (await database()).query('DELETE FROM projects WHERE id=$1', [idOf(event.params)]);
  return json({ ok: true });
}
