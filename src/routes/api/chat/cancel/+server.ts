import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { body } from '$lib/server/http';
import { activeRuns } from '$lib/server/runs';
import { requireScope } from '$lib/server/auth';
export async function POST(event: import('./$types').RequestEvent) {
  requireScope(event, 'generate');
  const { conversationId } = await body(event.request, z.object({ conversationId: z.string().uuid() }));
  activeRuns.get(conversationId)?.abort();
  return json({ ok: true });
}
