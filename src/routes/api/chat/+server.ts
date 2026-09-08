import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import { database } from '$lib/server/db';
import { body, sse } from '$lib/server/http';
import { resolveModel } from '$lib/server/config';
import { modelCatalog } from '$lib/server/model-catalog';
import { generate } from '$lib/server/providers';
import { assembleContext, attachSources, chatInputSchema, contextBudget, THINKING_HEADROOM, type Budget, type ChatInput, type SourceExcerpt } from '$lib/server/context';
import { readSettings } from '$lib/server/settings';
import { activeRuns, Job, jobStream, type Persist } from '$lib/server/runs';
import { requireScope } from '$lib/server/auth';
import { card, corpusConfig } from '$lib/server/corpus';
import { GHOST_HISTORY_TURNS, type ChatTurn, type ContextInfo, type Conversation, type Message } from '$lib/types';

/**
 * A ghost chat sends its whole conversation with every message, since the
 * server keeps none of it: this route reads more than the others. The
 * container's BODY_SIZE_LIMIT in compose.yaml allows the same.
 */
const CHAT_BODY_LIMIT = 2 * 1024 * 1024;

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

type Selected = NonNullable<ReturnType<typeof resolveModel>>;

/** A response ready to stream: what the browser is told first, what the model is given, and where the text goes as it arrives. */
interface Prepared {
  conversation: Conversation; user: Message; assistant: Message;
  turns: ChatTurn[]; manifest: ContextInfo; budget: Budget; thinking: boolean;
  /** How long the response may take, from Settings › Chat. */
  minutes: number;
  /** The rows the response is written to as it streams — none, for a ghost chat, which is written nowhere. */
  persist: Persist | null;
}

/**
 * One response per conversation, three per instance. Claimed before anything
 * is written, as a placeholder job that nobody can listen to yet; the real
 * job takes its place once the rows exist, and whatever fails first releases
 * the claim.
 */
function claim(id: string): void {
  if (activeRuns.has(id)) error(409, 'This conversation already has a response in progress');
  if (activeRuns.size >= 3) error(429, 'Three responses are already running. Wait for one to finish.');
  activeRuns.set(id, new Job(id, '', null));
}

/** A saved conversation: the new turn and the placeholder for its answer are rows before the browser hears of them. */
async function prepareSaved(input: ChatInput, id: string, selected: Selected): Promise<Prepared> {
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
  claim(id);
  try {
    db = await database();
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      if (!input.conversationId) {
        if (input.projectId && !(await client.query('SELECT 1 FROM projects WHERE id=$1 FOR KEY SHARE', [input.projectId])).rowCount) error(404, 'Project not found');
        await client.query('INSERT INTO conversations(id,title,project_id) VALUES($1,$2,$3)', [id, input.text!.slice(0, 80), input.projectId || null]);
      }
      let conversation: Conversation = (await client.query('SELECT * FROM conversations WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!conversation) error(404, 'Conversation not found');
      if ((await client.query("SELECT 1 FROM messages WHERE conversation_id=$1 AND status='streaming'", [id])).rowCount) error(409, 'This conversation already has a response in progress');
      let instructions = '';
      if (conversation.project_id) instructions = (await client.query('SELECT instructions FROM projects WHERE id=$1', [conversation.project_id])).rows[0]?.instructions || '';
      const settings = await readSettings(client);
      const thinking = input.thinking ?? settings.thinking;
      const budget = contextBudget(settings.contextTokens, selected.window, thinking ? THINKING_HEADROOM : 0);
      let user: Message;
      if (again) user = again;
      else {
        // The new turn follows the end of the branch being read: the one the
        // request names — null names the root, for a first message written
        // again — else the one the conversation was last read at.
        let parent: string | null = null;
        if (input.conversationId) {
          if (input.parentId) {
            if (!(await client.query('SELECT 1 FROM messages WHERE id=$1 AND conversation_id=$2', [input.parentId, id])).rowCount) error(404, 'The message to reply after was not found in this conversation');
            parent = input.parentId;
          } else if (input.parentId !== null) parent = conversation.leaf_id ?? (await client.query('SELECT id FROM messages WHERE conversation_id=$1 ORDER BY position DESC LIMIT 1', [id])).rows[0]?.id ?? null;
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
      const context = assembleContext(history as Parameters<typeof assembleContext>[0], instructions, settings.systemPrompt, budget.input);
      const manifest: ContextInfo = {
        ...context.manifest, window: selected.window,
        truncated: context.manifest.truncated || history.length === 101,
        sources: { count: attached.sources.length, tokens: attached.tokens, truncated: attached.truncated }
      };
      const assistant: Message = (await client.query(
        "INSERT INTO messages(id,conversation_id,role,status,model,context_manifest,parent_id) VALUES($1,$2,'assistant','streaming',$3,$4,$5) RETURNING *",
        [randomUUID(), id, input.model, JSON.stringify({ ...manifest, instructions, input: context.turns }), user.id]
      )).rows[0];
      conversation = (await client.query('UPDATE conversations SET updated_at=now(), leaf_id=$2 WHERE id=$1 RETURNING *', [id, assistant.id])).rows[0];
      await client.query('COMMIT');
      const connection = db;
      return {
        conversation, user, assistant, turns: context.turns, manifest, budget, thinking, minutes: settings.responseMinutes,
        persist: {
          checkpoint: async (content, thought) => {
            await connection.query('UPDATE messages SET content=$2, thinking=$3 WHERE id=$1', [assistant.id, content, thought]);
          },
          finish: async (content, status, failure, thought, thinkingMs, usage) => {
            await connection.query(
              'UPDATE messages SET content=$2,status=$3,error=$4,thinking=$5,thinking_ms=$6,input_tokens=$7,output_tokens=$8,tokens_estimated=$9,first_token_ms=$10,duration_ms=$11 WHERE id=$1',
              [assistant.id, content, status, failure || null, thought, thinkingMs, usage.input_tokens, usage.output_tokens, usage.tokens_estimated, usage.first_token_ms, usage.duration_ms]
            );
            await connection.query('UPDATE conversations SET updated_at=now() WHERE id=$1', [id]);
          }
        }
      };
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  } catch (err) { activeRuns.delete(id); throw err; }
}

/**
 * A ghost chat: nothing is inserted, updated or read back. The browser sent
 * the turns before this one; the server assembles the context from them
 * exactly as it would from a saved conversation's rows, streams the answer,
 * and forgets the exchange. What it reads is the instance's settings and,
 * when the chat is in a project, that project's instructions — both of which
 * a saved chat reads too. The messages handed back carry fresh ids and no
 * parent links: the tab that holds the chat links them into its own tree.
 */
async function prepareGhost(input: ChatInput, id: string, selected: Selected): Promise<Prepared> {
  const excerpts = await fetchSources(input.sources);
  claim(id);
  try {
    const db = await database();
    let instructions = '';
    if (input.projectId) {
      const project = (await db.query('SELECT instructions FROM projects WHERE id=$1', [input.projectId])).rows[0];
      if (!project) error(404, 'Project not found');
      instructions = project.instructions || '';
    }
    const settings = await readSettings(db);
    const thinking = input.thinking ?? settings.thinking;
    const budget = contextBudget(settings.contextTokens, selected.window, thinking ? THINKING_HEADROOM : 0);
    const attached = attachSources(excerpts, input.text!, budget.input);
    const history = input.history!.map(t => ({ role: t.role, content: t.content, status: t.status ?? 'complete' }));
    const context = assembleContext([...history, { role: 'user', content: attached.content, status: 'complete' }], instructions, settings.systemPrompt, budget.input);
    const manifest: ContextInfo = {
      ...context.manifest, window: selected.window,
      truncated: context.manifest.truncated || history.length >= GHOST_HISTORY_TURNS,
      sources: { count: attached.sources.length, tokens: attached.tokens, truncated: attached.truncated }
    };
    const now = new Date().toISOString();
    const user: Message = {
      id: randomUUID(), conversation_id: id, role: 'user', content: input.text!, status: 'complete', model: null, error: null,
      created_at: now, sources: attached.sources.length ? attached.sources : null, parent_id: null, thinking: null, thinking_ms: null,
      input_tokens: null, output_tokens: null, tokens_estimated: null, first_token_ms: null, duration_ms: null
    };
    const assistant: Message = {
      id: randomUUID(), conversation_id: id, role: 'assistant', content: '', status: 'streaming', model: input.model, error: null,
      created_at: now, sources: null, parent_id: user.id, thinking: null, thinking_ms: null,
      input_tokens: null, output_tokens: null, tokens_estimated: null, first_token_ms: null, duration_ms: null
    };
    const conversation: Conversation = { id, title: input.text!.slice(0, 80), project_id: input.projectId || null, created_at: now, updated_at: now, leaf_id: assistant.id };
    return { conversation, user, assistant, turns: context.turns, manifest, budget, thinking, minutes: settings.responseMinutes, persist: null };
  } catch (err) { activeRuns.delete(id); throw err; }
}

export async function POST(event: import('./$types').RequestEvent) {
  requireScope(event, 'generate');
  const { request } = event;
  const input = await body(request, chatInputSchema, CHAT_BODY_LIMIT);
  const selected = resolveModel((await modelCatalog(env)).providers, input.model);
  if (!selected) error(400, 'Model unavailable. Reload and select a model; check Settings → Models for discovery errors or configure a manual list.');
  const id = input.conversationId || randomUUID();
  const { conversation, user, assistant, turns, manifest, budget, thinking, minutes, persist } = input.ghost
    ? await prepareGhost(input, id, selected)
    : await prepareSaved(input, id, selected);

  // The job replaces the claim. A saved response answers to the Stop button
  // and the clock alone: the browser going away is not a reason to stop
  // writing what will be read later. A ghost's job ends with its request,
  // since nothing of it exists anywhere else.
  const job = new Job(id, assistant.id, persist, manifest.tokens);
  activeRuns.set(id, job);
  const timeout = AbortSignal.timeout(minutes * 60_000);
  const signal = AbortSignal.any([job.controller.signal, timeout, ...(persist ? [] : [request.signal])]);
  void job.run(generate(selected.provider, selected.model, turns, signal, { maxTokens: budget.output, thinking }), signal, timeout, minutes);

  const stream = jobStream(job, 0, [{ type: 'start', conversation, user, assistant, context: manifest }], persist ? undefined : () => job.abort());
  return sse(stream);
}
