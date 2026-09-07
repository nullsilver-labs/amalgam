import type { ChatTurn } from '../types';
import type { Provider } from './config';
import { eventData } from '../sse';
import { MAX_OUTPUT_TOKENS } from './context';
export class ProviderError extends Error {}
export interface GenerateOptions { maxTokens?: number; fetcher?: typeof fetch }
export async function* generate(
  provider: Provider, model: string, turns: ChatTurn[], signal: AbortSignal,
  { maxTokens = MAX_OUTPUT_TOKENS, fetcher = fetch }: GenerateOptions = {}
): AsyncGenerator<string> {
  const anthropic = provider.kind === 'anthropic';
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  if (anthropic) {
    headers['x-api-key'] = provider.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  const body = anthropic ? {
    model, stream: true, max_tokens: maxTokens,
    system: turns.filter(m => m.role === 'system').map(m => m.content).join('\n\n'),
    messages: turns.filter(m => m.role !== 'system')
  } : { model, stream: true, messages: turns, ...(provider.id === 'openai' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }) };
  const response = await fetcher(`${provider.baseUrl}/${anthropic ? 'messages' : 'chat/completions'}`, {
    method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error'
  });
  if (!response.ok) {
    await response.body?.cancel();
    if ([401, 403].includes(response.status)) throw new ProviderError('The provider rejected its credentials. Check the server configuration.');
    if (response.status === 429) throw new ProviderError('The provider reached its rate or usage limit. Try again later.');
    throw new ProviderError(`The provider returned HTTP ${response.status}. Check the endpoint and model configuration.`);
  }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    await response.body?.cancel();
    throw new ProviderError('The provider did not return an SSE stream. Check endpoint compatibility.');
  }
  let finished = false;
  for await (const data of eventData(response.body)) {
    if (data === '[DONE]') { finished = true; break; }
    let event;
    try { event = JSON.parse(data); }
    catch { throw new ProviderError('The provider returned a malformed stream.'); }
    if (event.error || event.type === 'error') throw new ProviderError('The provider reported a generation error.');
    if (anthropic) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && typeof event.delta.text === 'string') yield event.delta.text;
      if (event.type === 'message_delta' && event.delta?.stop_reason === 'max_tokens') throw new ProviderError('The response reached its output limit. The partial response was saved.');
      if (event.type === 'message_stop') { finished = true; break; }
    } else {
      const choice = event.choices?.[0];
      if (typeof choice?.delta?.content === 'string') yield choice.delta.content;
      if (choice?.finish_reason === 'length') throw new ProviderError('The response reached its output limit. The partial response was saved.');
      if (choice?.finish_reason === 'content_filter') throw new ProviderError('The provider filtered this response.');
      if (choice?.finish_reason === 'tool_calls' || choice?.finish_reason === 'function_call') throw new ProviderError('This model requested a tool. Tool execution is not enabled in this release.');
      if (choice?.finish_reason) finished = true;
    }
  }
  if (!finished) throw new ProviderError('The provider disconnected before completing its response.');
}
