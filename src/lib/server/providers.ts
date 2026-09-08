import type { ChatTurn } from '../types';
import type { Provider } from './config';
import { eventData } from '../sse';
import { MAX_OUTPUT_TOKENS } from './context';
export class ProviderError extends Error {}
/**
 * One streamed part of a reply: what the model showed of its reasoning, the
 * answer itself, or — once, near the end — what the provider counted it as.
 */
export type Piece =
  | { kind: 'thinking' | 'text'; text: string }
  | { kind: 'usage'; input: number | null; output: number | null };
export interface GenerateOptions {
  maxTokens?: number; fetcher?: typeof fetch;
  /** Ask a Claude model to think before answering, and to show a summary. Other protocols show reasoning only when the model sends it unasked. */
  thinking?: boolean;
}

/** How much of the end of `text` could be the beginning of `tag`. */
function partialTail(text: string, tag: string): number {
  for (let k = Math.min(tag.length - 1, text.length); k > 0; k--) if (tag.startsWith(text.slice(-k))) return k;
  return 0;
}

/*
 * Some OpenAI-style servers put a model's reasoning in the answer itself,
 * between <think> and </think>, and split the tags across chunks like any
 * other text. This takes the content deltas and hands back the reasoning and
 * the answer told apart. An opening tag counts only at the very start of the
 * reply, so a <think> quoted later — in a code sample, say — stays text; a
 * chunk that might be half a tag waits for the next one.
 */
export class ThinkTags {
  #mode: 'start' | 'thinking' | 'text' = 'start';
  #pending = '';
  #trim = false;
  push(chunk: string): Piece[] {
    const out: Piece[] = [];
    let text = this.#pending + chunk;
    this.#pending = '';
    if (this.#mode === 'start') {
      const rest = text.replace(/^\s+/, '');
      if (!rest || (rest.length < 7 && '<think>'.startsWith(rest))) { this.#pending = text; return out; }
      if (rest.startsWith('<think>')) { this.#mode = 'thinking'; out.push({ kind: 'thinking', text: '' }); text = rest.slice(7); }
      else this.#mode = 'text';
    }
    if (this.#mode === 'thinking') {
      const close = text.indexOf('</think>');
      if (close < 0) {
        const keep = partialTail(text, '</think>');
        if (text.length > keep) out.push({ kind: 'thinking', text: text.slice(0, text.length - keep) });
        this.#pending = text.slice(text.length - keep);
        return out;
      }
      if (close > 0) out.push({ kind: 'thinking', text: text.slice(0, close) });
      this.#mode = 'text'; this.#trim = true;
      text = text.slice(close + 8);
    }
    if (this.#trim) { text = text.replace(/^\s+/, ''); if (text) this.#trim = false; }
    if (text) out.push({ kind: 'text', text });
    return out;
  }
  /** Whatever was held back waiting for a tag that never came. */
  flush(): Piece[] {
    const text = this.#pending;
    this.#pending = '';
    return text ? [{ kind: this.#mode === 'thinking' ? 'thinking' : 'text', text }] : [];
  }
}

/**
 * OpenAI-style servers are asked to count the reply (`stream_options`), which
 * most do; one that answers 400 to the asking is asked again without it and
 * remembered, so it is asked once. A refusal is not billed, so the second
 * request is the first that costs anything.
 */
const refusesUsage = new Set<string>();

export async function* generate(
  provider: Provider, model: string, turns: ChatTurn[], signal: AbortSignal,
  { maxTokens = MAX_OUTPUT_TOKENS, fetcher = fetch, thinking = false }: GenerateOptions = {}
): AsyncGenerator<Piece> {
  const anthropic = provider.kind === 'anthropic';
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  if (anthropic) {
    headers['x-api-key'] = provider.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  const request = (countUsage: boolean) => anthropic ? {
    model, stream: true, max_tokens: maxTokens,
    system: turns.filter(m => m.role === 'system').map(m => m.content).join('\n\n'),
    messages: turns.filter(m => m.role !== 'system'),
    // Adaptive: the model decides how much to think. Summarised, so there is
    // something to show; the default on current models shows nothing.
    ...(thinking ? { thinking: { type: 'adaptive', display: 'summarized' } } : {})
  } : {
    model, stream: true, messages: turns, ...(provider.id === 'openai' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
    ...(countUsage ? { stream_options: { include_usage: true } } : {})
  };
  const url = `${provider.baseUrl}/${anthropic ? 'messages' : 'chat/completions'}`;
  let countUsage = !anthropic && !refusesUsage.has(provider.id);
  let response = await fetcher(url, { method: 'POST', headers, body: JSON.stringify(request(countUsage)), signal, redirect: 'error' });
  if (response.status === 400 && countUsage) {
    await response.body?.cancel();
    refusesUsage.add(provider.id);
    countUsage = false;
    response = await fetcher(url, { method: 'POST', headers, body: JSON.stringify(request(false)), signal, redirect: 'error' });
  }
  if (!response.ok) {
    await response.body?.cancel();
    if ([401, 403].includes(response.status)) throw new ProviderError('The provider rejected its credentials. Check the server configuration.');
    if (response.status === 429) throw new ProviderError('The provider reached its rate or usage limit. Try again later.');
    if (response.status === 400 && anthropic && thinking) throw new ProviderError('The provider rejected the request (HTTP 400). If this model does not support adaptive thinking, turn Thinking off in Settings → Chat.');
    throw new ProviderError(`The provider returned HTTP ${response.status}. Check the endpoint and model configuration.`);
  }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    await response.body?.cancel();
    throw new ProviderError('The provider did not return an SSE stream. Check endpoint compatibility.');
  }
  let finished = false;
  const tags = new ThinkTags();
  for await (const data of eventData(response.body)) {
    if (data === '[DONE]') { finished = true; break; }
    let event;
    try { event = JSON.parse(data); }
    catch { throw new ProviderError('The provider returned a malformed stream.'); }
    if (event.error || event.type === 'error') throw new ProviderError('The provider reported a generation error.');
    if (anthropic) {
      // A thinking block announces itself before any of its text — and a
      // redacted one, or one shown as nothing, never has any.
      // The request's size comes first, the reply's with the stop reason; the answer between them.
      if (event.type === 'message_start' && typeof event.message?.usage?.input_tokens === 'number') {
        const u = event.message.usage;
        yield { kind: 'usage', input: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: null };
      }
      if (event.type === 'message_delta' && typeof event.usage?.output_tokens === 'number') yield { kind: 'usage', input: null, output: event.usage.output_tokens };
      if (event.type === 'content_block_start' && ['thinking', 'redacted_thinking'].includes(event.content_block?.type)) yield { kind: 'thinking', text: '' };
      if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta' && typeof event.delta.thinking === 'string') yield { kind: 'thinking', text: event.delta.thinking };
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && typeof event.delta.text === 'string') yield { kind: 'text', text: event.delta.text };
      if (event.type === 'message_delta' && event.delta?.stop_reason === 'max_tokens') throw new ProviderError('The response reached its output limit. The partial response was saved.');
      if (event.type === 'message_stop') { finished = true; break; }
    } else {
      // The count comes in a last chunk with no choices, when it comes at all.
      if (event.usage && typeof event.usage === 'object') {
        const u = event.usage;
        yield { kind: 'usage', input: typeof u.prompt_tokens === 'number' ? u.prompt_tokens : null, output: typeof u.completion_tokens === 'number' ? u.completion_tokens : null };
      }
      const choice = event.choices?.[0];
      const delta = choice?.delta;
      // reasoning_content is what llama.cpp, vLLM and DeepSeek send; reasoning is OpenRouter's and Ollama's name for it.
      const reasoning = typeof delta?.reasoning_content === 'string' ? delta.reasoning_content : typeof delta?.reasoning === 'string' ? delta.reasoning : null;
      if (reasoning !== null) yield { kind: 'thinking', text: reasoning };
      if (typeof delta?.content === 'string') yield* tags.push(delta.content);
      if (choice?.finish_reason === 'length') throw new ProviderError('The response reached its output limit. The partial response was saved.');
      if (choice?.finish_reason === 'content_filter') throw new ProviderError('The provider filtered this response.');
      if (choice?.finish_reason === 'tool_calls' || choice?.finish_reason === 'function_call') throw new ProviderError('This model requested a tool. Tool execution is not enabled in this release.');
      if (choice?.finish_reason) finished = true;
    }
  }
  yield* tags.flush();
  if (!finished) throw new ProviderError('The provider disconnected before completing its response.');
}
