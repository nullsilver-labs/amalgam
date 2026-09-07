import http from 'node:http';

/*
 * Test fixture only: a stand-in for corpus's read API. No credentials, no
 * internet access, no real library — two invented cards and the four refusals
 * the connector has to tell apart.
 *
 *   Host must be mock-corpus:8892                         -> otherwise 421
 *   Authorization: Bearer crp_test_read                   -> allowed
 *   Authorization: Bearer crp_test_capture                -> 403, a real token
 *                                                            without the read scope
 *   anything else, or nothing                             -> 401
 *
 * The order matters and mirrors corpus's own: the Host check is a
 * DNS-rebinding defence and happens before any credential is looked at, so a
 * request that arrives under the wrong name never gets to say who it is.
 */

const CARDS = {
  'kestrel-01': {
    card: {
      id: 'kestrel-01', kind: 'source', card_type: 'article', title: 'Kestrels of the northbound verge',
      excerpt: 'Field notes from a stretch of motorway embankment.',
      original_uri: 'https://example.org/kestrels', mime_type: 'text/html',
      status: 'ready', created_at: '2026-03-04T09:00:00Z', updated_at: '2026-03-04T09:00:00Z', link_count: 0
    },
    body: 'The kestrel hovers above the northbound verge at dusk, holding its head perfectly still while the rest of it works.'
  },
  'rialto-02': {
    card: {
      id: 'rialto-02', kind: 'note', card_type: 'note', title: 'Barley at the Rialto',
      excerpt: 'A note about fifteenth-century grain prices.',
      original_uri: null, mime_type: 'text/markdown',
      status: 'ready', created_at: '2026-02-11T18:30:00Z', updated_at: '2026-02-11T18:30:00Z', link_count: 0
    },
    body: 'Barley malt was traded at the Rialto in fourteen twelve, priced by the staio and argued over in three languages.'
  }
};

const server = http.createServer(async (req, res) => {
  const send = (status, payload) => {
    const text = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
    res.end(text);
  };

  if (req.headers.host !== 'mock-corpus:8892') { send(421, { detail: 'host not allowed' }); return; }

  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (bearer === 'crp_test_capture') { send(403, { detail: 'token lacks the read scope' }); return; }
  if (bearer !== 'crp_test_read') { send(401, { detail: 'unknown token' }); return; }

  const url = new URL(req.url, 'http://mock-corpus:8892');

  if (req.method === 'GET' && url.pathname === '/api/status') {
    send(200, { cards: 2, jobs: { queued: 0, running: 0 }, embedder: 'ready' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/search') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const { q = '', limit = 20 } = JSON.parse(raw || '{}');
    const hits = Object.values(CARDS)
      .filter(entry => !q || `${entry.card.title} ${entry.body}`.toLowerCase().includes(String(q).toLowerCase()))
      .slice(0, limit)
      .map((entry, index) => ({ card: entry.card, score: 1 - index * 0.1, matched: ['lexical', 'semantic'], snippet: entry.body.slice(0, 80) }));
    send(200, { hits, total: hits.length, took_ms: 2, semantic: true });
    return;
  }

  const match = /^\/api\/cards\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'GET' && match) {
    const entry = CARDS[decodeURIComponent(match[1])];
    if (!entry) { send(404, { detail: 'no such card' }); return; }
    send(200, { card: entry.card, body: entry.body, provenance: { chunk_count: 1 }, collections: [] });
    return;
  }

  send(404, { detail: 'no such route' });
});

server.listen(8892, '0.0.0.0');
