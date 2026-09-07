import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import { database } from '$lib/server/db';
import { body } from '$lib/server/http';
import { resolveModel } from '$lib/server/config';
import { modelCatalog } from '$lib/server/model-catalog';
import { generate, ProviderError } from '$lib/server/providers';
import { assembleContext, attachSources, chatInputSchema, contextBudget, THINKING_HEADROOM, type Budget, type SourceExcerpt } from '$lib/server/context';
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

/**
 * The branch a message ends: itself and its ancestors, oldest first, at most
 * a hundred and one of them. What the model is given is one path through the
 * conversation, never the other branches beside it.
 */
const PATH = `WITH RECURSIVE path AS (
    SELECT id, parent_id, role, content, status, 0 AS depth FROM messages WHERE id = $1
    UNION ALL
    SELECT m.id, m.parent_id, m.role, m.content, m.status, path.depth + 1 FROM messages m JOIN path ON m.id = path.parent_id WHERE path.depth < 100
  ) SELECT role, content, status FROM path ORDER BY depth DESC`;

export async function POST(event: import('./$types').RequestEvent) {
  requireScope(event, 'generate');
  const { request } = event;
  const input = await body(request, chatInputSchema);
  const selected = resolveModel((await modelCatalog(env)).providers, input.model);
  if (!selected) error(400, 'Model unavailable. Reload and select a model; check Settings → Models for discovery errors or configure a manual list.');
  const id = input.conversationId || randomUUID();
  let db = await database();
  // A regeneration answers an existing user message again: the one the named
  // answer followed, with whatever it had attached. Both are read before the
  // transaction; a finished message never changes.
  let again: Message | null = null;
  if (input.regenerate) {
    const target: Message | undefined = (await db.query('SELECT * FROM messages WHERE id=$1 AND conversation_id=$2', [input.regenerate, id])).rows[0];
    if (!target || target.role !== 'assistant') error(404, 'The response to generate again was not found in this conversation');
    if (target.status === 'streaming') error(409, 'This conversation already has a response in progress');
    again = target.parent_id ? (await db.query('SELECT * FROM messages WHERE id=$1', [target.parent_id])).rows[0] ?? null : null;
    if (!again || again.role !== 'user') error(409, 'That response has no message to answer');
  }
  // Before the transaction: reading another application is slow and may fail,
  // and neither belongs inside a row lock on this conversation.
  const excerpts = await fetchSources(again ? again.sources?.map(s => s.id) : input.sources);
  if (activeRuns.has(id)) error(409, 'This conversation already has a response in progress');
  if (activeRuns.size >= 3) error(429, 'Three responses are already running. Wait for one to finish.');
  const controller = new AbortController();
  activeRuns.set(id, controller);
  let conversation: Conversation;
  let user: Message;
  let assistant: Message;
  let context: ReturnType<typeof assembleContext>;
  let manifest: ContextInfo;
  let budget: Budget;
  let thinking: boolean;
  try {
    db = await database();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      if (!input.conversationId) {
        if (input.projectId && !(await client.query('SELECT 1 FROM projects WHERE id=$1 FOR KEY SHARE', [input.projectId])).rowCount) error(404, 'Project not found');
        await client.query('INSERT INTO conversations(id,title,project_id) VALUES($1,$2,$3)', [id, input.text!.slice(0, 80), input.projectId || null]);
      }
      conversation = (await client.query('SELECT * FROM conversations WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!conversation) error(404, 'Conversation not found');
      if ((await client.query("SELECT 1 FROM messages WHERE conversation_id=$1 AND status='streaming'", [id])).rowCount) error(409, 'This conversation already has a response in progress');
      let instructions = '';
      if (conversation.project_id) instructions = (await client.query('SELECT instructions FROM projects WHERE id=$1', [conversation.project_id])).rows[0]?.instructions || '';
      const settings = await readSettings(client);
      thinking = settings.thinking;
      budget = contextBudget(settings.contextTokens, selected.window, thinking ? THINKING_HEADROOM : 0);
      if (again) user = again;
      else {
        // The new turn follows the end of the branch being read: the one the
        // request names, else the one the conversation was last read at.
        let parent: string | null = null;
        if (input.conversationId) {
          if (input.parentId) {
            if (!(await client.query('SELECT 1 FROM messages WHERE id=$1 AND conversation_id=$2', [input.parentId, id])).rowCount) error(404, 'The message to reply after was not found in this conversation');
            parent = input.parentId;
          } else parent = conversation.leaf_id ?? (await client.query('SELECT id FROM messages WHERE conversation_id=$1 ORDER BY position DESC LIMIT 1', [id])).rows[0]?.id ?? null;
        }
        user = (await client.query(
          "INSERT INTO messages(id,conversation_id,role,content,status,sources,parent_id) VALUES($1,$2,'user',$3,'complete',$4,$5) RETURNING *",
          [randomUUID(), id, input.text, null, parent]
        )).rows[0];
      }
      // The excerpts lead the turn the model is given; the row keeps the words
      // the person actually typed, with the attribution beside them.
      const attached = attachSources(excerpts, user.content, budget.input);
      if (!again && attached.sources.length) {
        user = (await client.query('UPDATE messages SET sources=$2 WHERE id=$1 RETURNING *', [user.id, JSON.stringify(attached.sources)])).rows[0];
      }
      const history: { role: string; content: string; status: string }[] = (await client.query(PATH, [user.id])).rows;
      if (attached.sources.length) history[history.length - 1].content = attached.content;
      context = assembleContext(history as Parameters<typeof assembleContext>[0], instructions, settings.systemPrompt, budget.input);
      manifest = {
        ...context.manifest, window: selected.window,
        truncated: context.manifest.truncated || history.length === 101,
        sources: { count: attached.sources.length, tokens: attached.tokens, truncated: attached.truncated }
      };
      assistant = (await client.query(
        "INSERT INTO messages(id,conversation_id,role,status,model,context_manifest,parent_id) VALUES($1,$2,'assistant','streaming',$3,$4,$5) RETURNING *",
        [randomUUID(), id, input.model, JSON.stringify({ ...manifest, instructions, input: context.turns }), user.id]
      )).rows[0];
      conversation = (await client.query('UPDATE conversations SET updated_at=now(), leaf_id=$2 WHERE id=$1 RETURNING *', [id, assistant.id])).rows[0];
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
        // What the model showed of its reasoning — '' once it reported any —
        // and how long it took to reach the first character of its answer.
        let thought: string | null = null;
        let thinkingMs: number | null = null;
        const started = Date.now();
        let status: MessageStatus = 'complete';
        let failure: string | undefined;
        let checkpoint = Date.now();
        try {
          for await (const piece of generate(selected.provider, selected.model, context.turns, signal, { maxTokens: budget.output, thinking })) {
            signal.throwIfAborted();
            if (piece.kind === 'thinking') {
              if (thought === null) thought = '';
              if (thought.length + piece.text.length <= 200_000) thought += piece.text;
              emit({ type: 'thinking', text: piece.text });
            } else {
              if (thought !== null && thinkingMs === null) thinkingMs = Date.now() - started;
              if (content.length + piece.text.length > 200_000) throw new ProviderError('The response exceeded the size limit. The partial response was saved.');
              content += piece.text;
              emit({ type: 'delta', text: piece.text });
            }
            if (Date.now() - checkpoint >= 1000) {
              await connection.query('UPDATE messages SET content=$2, thinking=$3 WHERE id=$1', [assistant.id, content, thought]);
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
        if (thought !== null && thinkingMs === null) thinkingMs = Date.now() - started;
        try {
          await connection.query('UPDATE messages SET content=$2,status=$3,error=$4,thinking=$5,thinking_ms=$6 WHERE id=$1', [assistant.id, content, status, failure || null, thought, thinkingMs]);
          await connection.query('UPDATE conversations SET updated_at=now() WHERE id=$1', [id]);
          emit({ type: 'done', status, error: failure, ...(thinkingMs !== null ? { thinking_ms: thinkingMs } : {}) });
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
