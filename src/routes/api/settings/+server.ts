import { json } from '@sveltejs/kit';
import { database } from '$lib/server/db';
import { body } from '$lib/server/http';
import { chatSettingsSchema, readSettings, writeSettings } from '$lib/server/settings';
import { requireScope } from '$lib/server/auth';
export async function GET(event: import('./$types').RequestEvent) {
  requireScope(event, 'admin');
  return json(await readSettings(await database()));
}
export async function PUT(event: import('./$types').RequestEvent) {
  requireScope(event, 'admin');
  const value = await body(event.request, chatSettingsSchema);
  const db = await database();
  await writeSettings(db, value);
  return json(await readSettings(db));
}
