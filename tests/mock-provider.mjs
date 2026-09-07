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
  for (let i = 0; i < answer.length && !closed; i += 8) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: answer.slice(i, i + 8) } }] })}\n\n`);
    await new Promise(resolve => setTimeout(resolve, delay));
    if (text.includes('[disconnect]') && i > 25) { res.end(); return; }
  }
  if (!closed) res.end('data: [DONE]\n\n');
});
server.listen(8891, '0.0.0.0');
