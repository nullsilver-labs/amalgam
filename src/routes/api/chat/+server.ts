import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import { database } from '$lib/server/db';
import { body } from '$lib/server/http';
import { resolveModel } from '$lib/server/config';
import { modelCatalog } from '$lib/server/model-catalog';
import { generate, ProviderError } from '$lib/server/providers';
import { assembleContext, attachSources, chatInputSchema, contextBudget, type Budget, type SourceExcerpt } from '$lib/server/context';
import { readSettings } from '$lib/server/settings';
import { activeRuns } from '$lib/server/runs';
import { requireScope } from '$lib/server/auth';
import { card, corpusConfig } from '$lib/server/corpus';
import type { ChatEvent, ContextInfo, Conversation, Message, MessageStatus } from '$lib/types';

/**
 * Fetch every attached card before anything is written down.
 *
 * All of them or none: a request that quietly dropped one source would answer
 * from a library the person thinks they gave it and did not. So the first
 * failure ends the request with a status and a sentence naming what went wrong,
 * and nothing has been stored yet when it does.
 */
async function fetchSources(ids: string[] | undefined): Promise<SourceExcerpt[]> {
  if (!ids?.length) return [];
  const config = corpusConfig(env);
  if (!config.configured) error(400, config.problem?.detail || 'The corpus connector is not configured on this server.');
  const excerpts: SourceExcerpt[] = [];
  for (const id of ids) {
    const result = await card(config, id);
    if (result.missing) error(404, 'One of the attached sources is no longer in your corpus library. Remove it and send again.');
    if (result.state !== 'ok' || !result.source) {
      if (result.state === 'rate_limited') error(429, `corpus could not be read (${result.state}). ${result.detail}`);
      error(502, `corpus could not be read (${result.state}). ${result.detail}`);
    }
    if (!result.source.body.trim()) {
      error(409, `“${result.source.title}” has no extracted text yet — corpus may still be indexing it. Remove it and send again.`);
    }
    excerpts.push(result.source);
  }
  return excerpts;
}

export async function POST(event: import('./$types').RequestEvent) {
  requireScope(event, 'generate');
  const { request } = event;
  const input = await body(request, chatInputSchema);
  const selected = resolveModel((await modelCatalog(env)).providers, input.model);
  if (!selected) error(400, 'Model unavailable. Reload and select a model; check Settings → Models for discovery errors or configure a manual list.');
  // Before the transaction: reading another application is slow and may fail,
  // and neither belongs inside a row lock on this conversation.
  const excerpts = await fetchSources(input.sources);
  const id = input.conversationId || randomUUID();
  if (activeRuns.has(id)) error(409, 'This conversation already has a response in progress');
  if (activeRuns.size >= 3) error(429, 'Three responses are already running. Wait for one to finish.');
  const controller = new AbortController();
  activeRuns.set(id, controller);
  let db;
  let conversation: Conversation;
  let user: Message;
  let assistant: Message;
  let context: ReturnType<typeof assembleContext>;
  let manifest: ContextInfo;
  let budget: Budget;
  try {
    db = await database();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      if (!input.conversationId) {
        if (input.projectId && !(await client.query('SELECT 1 FROM projects WHERE id=$1 FOR KEY SHARE', [input.projectId])).rowCount) error(404, 'Project not found');
        await client.query('INSERT INTO conversations(id,title,project_id) VALUES($1,$2,$3)', [id, input.text.slice(0, 80), input.projectId || null]);
      }
      conversation = (await client.query('SELECT * FROM conversations WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!conversation) error(404, 'Conversation not found');
      if ((await client.query("SELECT 1 FROM messages WHERE conversation_id=$1 AND status='streaming'", [id])).rowCount) error(409, 'This conversation already has a response in progress');
      let instructions = '';
      if (conversation.project_id) instructions = (await client.query('SELECT instructions FROM projects WHERE id=$1', [conversation.project_id])).rows[0]?.instructions || '';
      const settings = await readSettings(client);
      budget = contextBudget(settings.contextTokens, selected.window);
      // The excerpts lead the turn the model is given; the row keeps the words
      // the person actually typed, with the attribution beside them.
      const attached = attachSources(excerpts, input.text, budget.input);
      user = (await client.query(
        "INSERT INTO messages(id,conversation_id,role,content,status,sources) VALUES($1,$2,'user',$3,'complete',$4) RETURNING *",
        [randomUUID(), id, input.text, attached.sources.length ? JSON.stringify(attached.sources) : null]
      )).rows[0];
      const history: { role: string; content: string; status: string }[] =
        (await client.query('SELECT role,content,status FROM messages WHERE conversation_id=$1 ORDER BY position DESC LIMIT 101', [id])).rows.reverse();
      if (attached.sources.length) history[history.length - 1].content = attached.content;
      context = assembleContext(history as Parameters<typeof assembleContext>[0], instructions, settings.systemPrompt, budget.input);
      manifest = {
        ...context.manifest, window: selected.window,
        truncated: context.manifest.truncated || history.length === 101,
        sources: { count: attached.sources.length, tokens: attached.tokens, truncated: attached.truncated }
      };
      assistant = (await client.query("INSERT INTO messages(id,conversation_id,role,status,model,context_manifest) VALUES($1,$2,'assistant','streaming',$3,$4) RETURNING *", [randomUUID(), id, input.model, JSON.stringify({ ...manifest, instructions, input: context.turns })])).rows[0];
      await client.query('UPDATE conversations SET updated_at=now() WHERE id=$1', [id]);
      await client.query('COMMIT');
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  } catch (err) { activeRuns.delete(id); throw err; }

  const encoder = new TextEncoder();
  const timeout = AbortSignal.timeout(180_000);
  const signal = AbortSignal.any([controller.signal, timeout, request.signal]);
  const connection = db;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(sink) {
      function emit(event: ChatEvent) {
        if (!closed) {
          try { sink.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); }
          catch { closed = true; controller.abort(); }
        }
      }
      emit({ type: 'start', conversation, user, assistant, context: manifest });
      // Keep intermediary proxies from timing out during provider thinking time.
      const heartbeat = setInterval(() => {
        if (!closed) {
          try { sink.enqueue(encoder.encode(': heartbeat\n\n')); }
          catch { closed = true; controller.abort(); }
        }
      }, 15_000);
      void (async () => {
        let content = '';
        let status: MessageStatus = 'complete';
        let failure: string | undefined;
        let checkpoint = Date.now();
        try {
          for await (const text of generate(selected.provider, selected.model, context.turns, signal, { maxTokens: budget.output })) {
            signal.throwIfAborted();
            if (content.length + text.length > 200_000) throw new ProviderError('The response exceeded the size limit. The partial response was saved.');
            content += text;
            emit({ type: 'delta', text });
            if (Date.now() - checkpoint >= 1000) {
              await connection.query('UPDATE messages SET content=$2 WHERE id=$1', [assistant.id, content]);
              checkpoint = Date.now();
            }
          }
          signal.throwIfAborted();
          if (!content.trim()) throw new ProviderError('The model returned no text. This release supports text responses only.');
        } catch (err) {
          status = signal.aborted && !timeout.aborted ? 'cancelled' : 'failed';
          failure = timeout.aborted ? 'The response timed out after three minutes.'
            : status === 'cancelled' ? 'Response stopped. Any partial text was saved.'
            : err instanceof ProviderError ? err.message : 'Could not finish the response. Check the provider connection and database.';
        }
        try {
          await connection.query('UPDATE messages SET content=$2,status=$3,error=$4 WHERE id=$1', [assistant.id, content, status, failure || null]);
          await connection.query('UPDATE conversations SET updated_at=now() WHERE id=$1', [id]);
          emit({ type: 'done', status, error: failure });
        } catch {
          console.error('Failed to persist response', assistant.id);
          emit({ type: 'error', error: 'The response could not be saved. Reload before continuing.' });
        } finally {
          clearInterval(heartbeat);
          activeRuns.delete(id);
          if (!closed) { closed = true; sink.close(); }
        }
      })();
    },
    cancel() { closed = true; controller.abort(); }
  });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no'
  } });
}
