import { randomUUID } from 'node:crypto';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { body } from '$lib/server/http';
import { database } from '$lib/server/db';
import { requireScope } from '$lib/server/auth';
const projectInput = z.object({ name: z.string().trim().min(1).max(100), instructions: z.string().max(12000).default('') });
export async function POST(event: import('./$types').RequestEvent) {
  requireScope(event, 'write');
  const input = await body(event.request, projectInput);
  const result = await (await database()).query('INSERT INTO projects(id,name,instructions) VALUES($1,$2,$3) RETURNING *', [randomUUID(), input.name, input.instructions]);
  return json(result.rows[0], { status: 201 });
}
