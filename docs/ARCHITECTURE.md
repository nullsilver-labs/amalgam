# Architecture

## Product boundary

amalgam is a complete AI interface in intent: chat, research, creation, organization, and optional actions. The first implementation is a working text-chat slice. Projects are optional relationships, never the root dependency of all features.

A new product succeeds the retired personal-agent harness. The old two-package/four-tool/no-UI charter does not apply. No Pi dependency, subscription credential reuse, or agent execution is hidden in this implementation.

## Implemented

```text
Browser / Svelte 5 + Nullsilver tokens
  | same-origin JSON commands + SSE response stream
SvelteKit / Node adapter
  |-- hosting policy (origin, private-HTTP opt-in, trusted proxy peers)
  |-- access (session rows, scoped bearer tokens, host/origin checks)
  |-- conversations + optional projects
  |-- context assembly (bounded history + project instructions + attached excerpts)
  |-- corpus connector (read-only: probe, search, one card at a time)
  |-- text provider adapters (OpenAI-compatible / Anthropic)
  |-- streaming lifecycle + cancellation registry
  `-- PostgreSQL persistence

Optional Docker networks: corpus API (read, on request) + stateless embedder
(the embedder is configuration only; nothing calls it yet)
```

One codebase, one app process, one PostgreSQL database. `pgvector/pgvector:pg17` is the database image for future retrieval; no vector extension/index is created until actually needed. No Redis, object store, worker daemon, or premature plugin framework.

- `src/lib/types.ts`: public conversation/message/model and streaming event contracts.
- `src/lib/server/config.ts`: server-owned model allowlist; no browser-controlled endpoints.
- `src/lib/server/providers.ts`: native wire protocols and normalized text deltas. No automatic retries that could cause duplicate billing.
- `src/lib/sse.ts`: incremental UTF-8/SSE framing shared by browser and providers.
- `src/lib/server/context.ts`: bounded whole-exchange selection, explicit project instructions, and `attachSources` — the excerpts a message carries, each body cut to 6,000 characters and the block held to half the request's input budget, the last-listed card dropped first and the first kept even if it has to be shortened. Pure, so the trimming arithmetic is tested rather than observed. It also owns `chatInputSchema`, which is where a `sources` list is constrained to at most five ids of `[A-Za-z0-9_-]{1,64}` — ids, never text, never a URL, never an address the server is asked to fetch.
- `src/lib/server/corpus.ts`: the one place amalgam reads from corpus, and the whole of it. `corpusConfig(env)` decides whether an address and a read-scoped token both exist; `probe`, `search` and `card` call the three read routes, with per-call timeouts and a ceiling on how much of an answer is read; `classify` is pure and turns a response status or a thrown fetch error into one of seven states, each with a sentence naming what to change. It is the module that keeps reachability and authorisation apart: a 401, a 403, a 421 and a refused connection are four different answers with four different fixes, and none of them is "unreachable" standing in for the others. The token is read from the environment, put in one header, and never logged, never returned and never given to the browser; upstream response bodies are not passed through either — the routes copy out a fixed set of fields and drop the rest.
- `src/routes/api/integrations/corpus/`: the two routes the browser uses, both `read`-scoped. `GET` probes and caches the answer in memory for 30 seconds (Settings' "Check now" asks past it); `POST /search` returns rows already stripped of everything a page has no business seeing. A connector without both an address and a token answers 503 rather than pretending.
- `src/lib/destination.ts`: pure, browser-safe, and deliberately pessimistic — loopback, `host.docker.internal`, RFC1918 and `fc00::/7` literals and a bare service name with no dots are this machine; everything else, `.local` and `.internal` and `.test` included, is somewhere else. A suffix is a naming convention, not a route. Being wrong in the cautious direction shows one more honest sentence; being wrong the other way sends private text away in silence.
- `src/lib/server/schema.sql`, `db.ts`: transactional startup migration and recovery.
- `src/routes/api/chat/+server.ts`: transactionally accepts a user message + assistant placeholder before emitting start; checkpoints partial text and records terminal status.
- `src/lib/server/hosting.ts`: the pure hosting policy. `hostingPolicy(env)` decides whether an ORIGIN may be served at all — plain HTTP off loopback needs `AMALGAM_PRIVATE_HTTP`, and no private-looking address is ever taken as consent; `peerIsTrusted` matches the socket peer against `AMALGAM_TRUSTED_PROXIES` (v4 and v6 CIDRs, parsed here rather than by a dependency); `claimedHost` reads `X-Forwarded-Host`/`-Proto` from a trusted peer and ignores them from anyone else. adapter-node's `ADDRESS_HEADER`/`HOST_HEADER`/`PROTOCOL_HEADER` are deliberately unset so `getClientAddress()` is the real TCP peer.
- `src/lib/server/auth.ts`, `tokens.ts`: the access model. A browser session is a row — 256 random bits in the cookie, SHA-256 in `sessions`, a device label parsed from the User-Agent, `last_seen_at` refreshed at most once a minute — and carries every scope. An integration token is a row in `api_tokens` with the scopes it was given, accepted on `/api/*` only. `requireScope(event, scope)` is the single gate each API route calls; `requireSession(event)` guards the routes that manage credentials, so a token can never mint a token or touch a device. Changing `APP_PASSWORD` is noticed through a `password_fingerprint` row and revokes every session.
- `src/hooks.server.ts`: the one place all of that is applied. It resolves the principal onto `event.locals`, checks the claimed Host against ORIGIN, requires a same-origin `Origin` on cookie-authenticated writes (bearer requests are exempt: presenting a secret is the intent a cookie cannot prove), and refuses an unaccepted hosting configuration with 503.
- `src/lib/capabilities.ts`: what the browser can actually do — secure context, which clipboard path exists, whether a microphone could be asked for. Pure, so it is tested against a plain object; `clipboard.ts` and Settings › Access both read it rather than assuming.
- `src/lib/server/settings.ts`, `routes/api/settings`: one jsonb row of instance chat settings (system prompt, new-chat suggestions), validated both ways; the chat route reads the system prompt inside its transaction and it leads the system turn ahead of project instructions.
- `src/lib/styles`: the Nullsilver token sheet, extended for an app surface (light theme, control heights, the radius rule) the way corpus extends it; element defaults; the one global sheet for rendered Markdown. Every other style is scoped to its component.
- `src/lib/state`: three rune stores — `workspace` (data and every API action), `ui` (which dialog is open), `prefs` (theme, model, layout; persisted). Components read fields and call methods; nothing else talks to the API. The workspace holds one `Session` per open tab — a conversation or a blank one, its messages, draft, and the response it may be writing, with its own abort controller — and forwards the active tab's fields under the names components read (`workspace.messages` is the active tab's thread — the branch being read, root first, computed from the tab's full message list and its leaf). A conversation opens in the active tab unless that tab is writing, in which case it opens beside it; a new chat opens beside the active tab unless that tab is already blank, which it reuses; open tabs are kept in this browser tab's session storage and restored on reload, fetching a tab's messages when it is first activated. The server is unchanged: it already allows three concurrent runs and one per conversation.
- `src/lib/components`: the shell (Dock — the rail — and its ChatsPanel, or the pinned Sidebar — both render one ChatList; Topbar, Welcome, Transcript, Message, Composer, ModelPicker), the primitives they share (Button, Menu, Dialog, Notice, Logo, Markdown) and the dialogs (search palette, settings, project, rename, delete, context). The conversation sits on the page plate — one rounded (`--radius-xl`), hairline-ringed surface on the void, inset by the page edge and filling the page. The rail (`--rail-w`, 64px: a standard control with the page edge either side) stands down the left edge with no field of its own, the way the site's header is a tile and a slab on the page: the brand tile at its head in the top bar's row, New chat, Search and Chats at the exact middle of the page under the sliding "void" highlight (a silver disc), Settings at its foot; on a phone it lies down in the top bar. The pinned sidebar is a column of text on the void beside the plate, with no field of its own. The top bar is the site's header height (the 23px tile plus the page edge above and below; a phone keeps a control's height for the rail lying in it), and its row begins where the plate does (`--plate-x`: the rail, or a page edge past the sidebar's rows), so the open chats — a TabStrip of bare 32px labels with nothing drawn around them, the current tab lit as the archive's current row is (strong text on a `--color-hover` wash that travels to the pointer's tab), always shown with one tab at least — line up with the plate's left edge and the conversation's "…" with its right. No title with one chat open — that lives in the browser tab and the Chats panel. On a phone the plate runs edge to edge and the open chats head the Chats panel.

A DB partial unique index prevents simultaneous streaming responses in the same conversation. Row locks serialize generation start and deletion. An in-process registry supports cancellation and caps global concurrency at three. No claim of distributed coordination: do not scale app replicas against the same DB.

Messages are provider-independent rows, with model identity and completion status. The current content type is text; do not mistake that for a completed multimodal schema. A generation's context snapshot records selected inputs and instructions for later inspection/debugging; it duplicates private text and belongs in the same backup/security boundary as messages — and when a message carried corpus excerpts, that snapshot contains them, which is the same boundary corpus's own library is in but a second copy of it.

Messages form a tree (schema version 4): `parent_id` names the message a message follows, and messages that share a parent are branches — an answer generated again sits beside the first, under the same user message. `conversations.leaf_id` is the end of the branch last read, set by every generation and by the client when a person switches branches, so the same branch opens on every device and an integration that continues a conversation continues the one being read. What the model is given is one path, walked up from the new message with a recursive query; the other branches never enter the context. A regeneration (`POST /api/chat` with `regenerate: <assistant message id>`) answers that message's parent again with the same attached sources, re-read from corpus. An assistant message also keeps `thinking` — what the model showed of its reasoning, `''` when it reported thinking but showed none, null when it reported none — and `thinking_ms`, the time from the request to the first character of the answer. The provider adapter yields typed pieces (thinking or text); OpenAI-style reasoning fields and inline `<think>` tags are told apart in `ThinkTags`, and Claude models are asked for adaptive thinking with a shown summary while the instance's Thinking setting is on.

A user message's `sources` column (schema version 3) is attribution, not content: the ids, titles, types, links and character counts of the cards that were quoted. The message's own text stays what the person typed. That split is what lets the transcript say where a request's material came from after a reload without keeping a stale duplicate of the library.

The UI shows recent 200 conversations; full-text keyword search searches all conversations and returns at most 200. This is not a paginated archive UI yet. Project lists and transcripts are unpaginated in this first release.

## Deliberate next seams

### Models, capabilities, runtimes

Keep these distinct:

1. **Model adapter**: generates content from canonical input. Provider-specific capabilities and limitations remain explicit.
2. **Capability adapter**: web search/read, image generation/editing, transcription, speech synthesis. Its provider need not be the selected chat provider.
3. **Runtime adapter**: an actual agent session such as Codex app-server. Preserve its authentication/approval/execution model, rather than impersonating a generic API.

No tool marketplace, universal API compatibility promise, or automatic cloud fallback.

### Assets and durable jobs

Before file/image/audio support, add canonical assets with original source, MIME, size/hash, provenance, versions, and a storage adapter (local directory first; S3-compatible for hosted mode). Ownership is independent of project membership. Never execute generated HTML on the application origin.

Before asynchronous research/media/agents, move generation to persisted jobs and sequenced events with reconnect/replay/cancel semantics. Use a PostgreSQL job queue and a worker from this same codebase initially. Do not patch long-running jobs onto request-owned streams and call them durable.

Live voice needs a provider-appropriate real-time transport (WebRTC/WebSocket), not the text SSE interface.

### Retrieval

The corpus connector is built and is the shape the rest should follow: an optional authenticated, read-only client of another application — never direct access to its database or library — reaching an explicit `CORPUS_BASE_URL` with a dedicated read-scoped `CORPUS_TOKEN`, server side, with no corpus secret in amalgam's browser. Selection is the user's, source by source; the excerpts are quoted, attributed and disclosed; nothing is captured back.

What is still missing is amalgam's own retrieval: attachment extraction, bounded chunking, lexical and vector search over material amalgam holds, and citations into it. That is a separate vertical slice, and the connector is not a substitute for it — it reads what you point at, it does not index anything. Small documents may be included whole. Keep generated knowledge outside corpus unless explicitly exported by the user.

Embeddings are model-versioned derived data. A shared inference endpoint can serve both apps, but does not mean shared indices, automatic content sharing, or unlimited compute. See deployment contract.

### Hosted security

Public multi-user hosting requires identities, tenant ownership and authorization enforced on every DB/retrieval/storage route, quotas, abuse/rate controls, credential encryption with separate key management, and isolated execution environments. One instance password, one owner's sessions and a handful of scoped integration tokens are not that architecture; they are the right size for a single-user instance and no larger. Don't simply expose the local app as public SaaS.

## Roadmap, not a permanent restriction

1. Strengthen daily chat: provider-specific token budgets, native OpenAI Responses/Gemini, editing a sent message as a branch, full archive pagination, better connection setup.
2. Assets + documents + project knowledge/retrieval of amalgam's own (the corpus connector is done: read-only, user-selected, disclosed).
3. Web search/read with citations; selectable tools and context inspector.
4. Image generation/editing; speech, transcription and real-time voice through the shared asset/job model.
5. Official runtime integrations, durable research/agent jobs, sandboxed previews.
6. Multi-user hosted deployment when the data/security boundary has been implemented and reviewed.

Each increment should work end to end. Disabled capability claims are not features. No need to make a project before asking an ordinary question.
