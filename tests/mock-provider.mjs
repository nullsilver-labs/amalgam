import http from 'node:http';
// Test fixture only: no credentials, internet access, inference, or user data.
const server = http.createServer(async (req, res) => {
  if (req.url === '/health') { res.end('ok'); return; }
  if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const input = JSON.parse(raw);
  const text = input.messages.at(-1).content;
  if (text.includes('[http-error]')) { res.writeHead(429).end('sensitive-upstream-error'); return; }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  let closed = false; res.on('close', () => closed = true);
  const answer = text.includes('[xss]') ? '<img src="https://example.invalid/tracker" onerror="alert(1)"><script>alert(1)</script>\n\n**Safe text** [unsafe](javascript:alert%281%29)'
    : `## A little clarity\n\nThis is a **local test response**, not a real model.\n\n${input.messages[0].content.includes('Italian') ? 'Ciao! Project instructions arrived.\n\n' : ''}You asked: ${text}\n\n- Conversations persist in PostgreSQL.\n- The model connection can be changed.\n\n\`\`\`js\nconst thought = 'a beginning';\n\`\`\``;
  const delay = text.includes('[slow]') ? 180 : 5;
  // [think] reasons first, the way llama.cpp and vLLM stream it; [think-tags] the way servers that leave <think> in the text do.
  if (text.includes('[think]')) {
    const thought = 'Considering the question. The user wants to see a model think before it answers.';
    for (let i = 0; i < thought.length && !closed; i += 8) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: thought.slice(i, i + 8) } }] })}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  const body = text.includes('[think-tags]') ? `<think>Tagged reasoning, split across chunks.</think>\n\n${answer}` : answer;
  for (let i = 0; i < body.length && !closed; i += 8) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: body.slice(i, i + 8) } }] })}\n\n`);
    await new Promise(resolve => setTimeout(resolve, delay));
    if (text.includes('[disconnect]') && i > 25) { res.end(); return; }
  }
  // Asked to count, the last chunk carries the count and no choices, as OpenAI-style servers do.
  if (!closed && input.stream_options?.include_usage) {
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 321, completion_tokens: 123, total_tokens: 444 } })}\n\n`);
  }
  if (!closed) res.end('data: [DONE]\n\n');
});
server.listen(8891, '0.0.0.0');
