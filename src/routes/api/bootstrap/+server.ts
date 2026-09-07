import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { database } from '$lib/server/db';
import { publicModels, readProviders } from '$lib/server/config';
import { readSettings } from '$lib/server/settings';
import { requireScope } from '$lib/server/auth';
import { corpusConfig } from '$lib/server/corpus';
export async function GET(event: import('./$types').RequestEvent) {
  requireScope(event, 'read');
  const db = await database();
  const [conversations, projects, settings] = await Promise.all([
    db.query('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 200'),
    db.query('SELECT * FROM projects ORDER BY created_at DESC'),
    readSettings(db)
  ]);
  // Whether the connector exists, and the address a person could click — never
  // the token, and never a diagnosis, which costs a request to corpus and is
  // asked for separately.
  const corpus = corpusConfig(env);
  return json({ conversations: conversations.rows, projects: projects.rows,
    models: publicModels(readProviders(env)),
    integrations: {
      corpus: { configured: corpus.configured, publicUrl: corpus.publicUrl },
      embeddings: Boolean(env.EMBEDDING_BASE_URL)
    },
    settings
  });
}
