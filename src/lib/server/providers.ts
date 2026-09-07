import type { ChatTurn } from '../types';
import type { Provider } from './config';
import { eventData } from '../sse';
import { MAX_OUTPUT_TOKENS } from './context';
export class ProviderError extends Error {}
/** One streamed part of a reply: what the model showed of its reasoning, or the answer itself. */
export interface Piece { kind: 'thinking' | 'text'; text: string }
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
  const body = anthropic ? {
    model, stream: true, max_tokens: maxTokens,
    system: turns.filter(m => m.role === 'system').map(m => m.content).join('\n\n'),
    messages: turns.filter(m => m.role !== 'system'),
    // Adaptive: the model decides how much to think. Summarised, so there is
    // something to show; the default on current models shows nothing.
    ...(thinking ? { thinking: { type: 'adaptive', display: 'summarized' } } : {})
  } : { model, stream: true, messages: turns, ...(provider.id === 'openai' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }) };
  const response = await fetcher(`${provider.baseUrl}/${anthropic ? 'messages' : 'chat/completions'}`, {
    method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error'
  });
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
      if (event.type === 'content_block_start' && ['thinking', 'redacted_thinking'].includes(event.content_block?.type)) yield { kind: 'thinking', text: '' };
      if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta' && typeof event.delta.thinking === 'string') yield { kind: 'thinking', text: event.delta.thinking };
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && typeof event.delta.text === 'string') yield { kind: 'text', text: event.delta.text };
      if (event.type === 'message_delta' && event.delta?.stop_reason === 'max_tokens') throw new ProviderError('The response reached its output limit. The partial response was saved.');
      if (event.type === 'message_stop') { finished = true; break; }
    } else {
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
