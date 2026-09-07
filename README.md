# amalgam

A self-hosted AI interface by **Nullsilver**. Conversation, research, and creation in one quiet workspace—not tied to one model or organized around a mandatory project.

**0.1 is a working text-chat foundation**, not the complete multimodal product. SvelteKit, TypeScript, PostgreSQL, Docker Compose. Near-black, warm silver, locally served typography.

## Start

Requires Docker Engine + Compose. Node 22+ is needed only for setup/development commands.

```sh
node scripts/setup.mjs
# Edit .env: configure a provider's API key and explicit model IDs.
docker compose up -d --build --wait
```

By default, open **http://localhost:8790**. Reaching it from another machine is the next section.

Sign in with `APP_PASSWORD` from `.env`. The setup script generates independent random application and database passwords and won't overwrite an existing file. No model request is made until you send a message. The interface works without configured models, but cannot generate responses.

Without Node, copy `.env.example` to `.env` and set `APP_PASSWORD` and `POSTGRES_PASSWORD` yourself using `openssl rand -hex 24`. Use URL-safe hexadecimal for the database password because it is interpolated into a connection URL. Protect `.env` (`chmod 600 .env`).

### Connections

Use the model IDs your account or server supports. No automatic catalog, default paid model, subscription-token import, or fallback provider.

```dotenv
# OpenAI Chat Completions-compatible text models
OPENAI_API_KEY=your-key
OPENAI_MODELS=your-model-id,another-model-id

# Anthropic Messages API
ANTHROPIC_API_KEY=your-key
ANTHROPIC_MODELS=your-claude-model-id

# Local Ollama, llama.cpp, or another compatible service
COMPATIBLE_BASE_URL=http://host.docker.internal:11434/v1
COMPATIBLE_MODELS=your-local-model
# COMPATIBLE_API_KEY=optional-key
# COMPATIBLE_NAME=How the picker should name it

# Any number more: name them, then give each a prefix of its own
PROVIDERS=openrouter,ollama
OPENROUTER_NAME=OpenRouter
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_API_KEY=your-key
OPENROUTER_MODELS=anthropic/claude-sonnet-4:200k
OLLAMA_NAME=Ollama
OLLAMA_BASE_URL=http://host.docker.internal:11434/v1
OLLAMA_MODELS=llama3.1:8b:8k
```

The three built-in slots keep their defaults. A slot named in `PROVIDERS` reads `<PREFIX>_BASE_URL`, `<PREFIX>_MODELS`, optionally `<PREFIX>_API_KEY` and `<PREFIX>_NAME`, and `<PREFIX>_KIND=anthropic` when the endpoint speaks Anthropic's Messages API rather than OpenAI's chat completions. Model IDs are qualified by their slot, so the same model behind two providers stays two choices. The compose file hands the whole `.env` to the app, so a new slot needs no compose change.

Append `:<tokens>` or `:<n>k` to a model ID to declare its context window, as in `gpt-5:400k` or `llama3.1:8b:8k`; the server then trims history to fit it, leaving room for the reply. Only a trailing all-digit segment of a thousand or more is read this way, so IDs with colons of their own are safe. Enable only the connections you use, then `docker compose up -d` to recreate the app with changed environment settings. Native providers require a key; compatible endpoints may be keyless. The UI shows model and destination, never keys. “Configured” is not a verified connectivity claim.

A host-local inference server must be reachable from the Docker host-gateway interface; a server bound only to host `127.0.0.1` usually is not. Prefer a shared Docker network and service DNS for containerized inference. Do not expose an unauthenticated inference server to your LAN or the internet just to make this work. The OpenAI slot sends `max_completion_tokens`; every other OpenAI-style slot sends `max_tokens`. Not every vendor's nominally compatible API supports these exact text-chat semantics.

## Where it is served

`ORIGIN` is only an address: the exact scheme, host and port a browser will type. Whether that address is acceptable is a separate, explicit decision, because safety is never inferred from a private-looking IP.

| Mode | Transport | Exposure | How to run it |
|---|---|---|---|
| Local machine | HTTP is fine | loopback only | `docker compose up -d --build --wait` |
| Private LAN or VPN | HTTPS preferred; HTTP allowed **explicitly** | one chosen interface | `docker compose -f compose.yaml -f compose.private.yaml up -d --build --wait` |
| Public-facing | HTTPS required | behind a reverse proxy you run | `docker compose -f compose.yaml -f compose.proxied.yaml up -d --build --wait` |

For the private mode, set `AMALGAM_BIND_ADDRESS` to the server's LAN address and `ORIGIN` to `http://that-address:8790`. The overlay carries `AMALGAM_PRIVATE_HTTP=true`, which is you saying out loud that passwords and conversations will travel unencrypted unless the tunnel encrypts them, and that the browser will not treat the page as a secure context — no clipboard API, no microphone — however private the network is. A VPN encrypts the wire; it does not change that. Without the opt-in the app answers 503 to everything but `/api/health` and names the variable to set.

For the proxied mode, set `ORIGIN` to the public https address and `AMALGAM_TRUSTED_PROXIES` to your proxy's IP or CIDR. A proxy that preserves the browser's `Host` header needs nothing else. A proxy that rewrites `Host` must send `X-Forwarded-Host`, and the app believes that header only from the peers named there — from anyone else it is ignored, so a spoofed header on the published port changes nothing. Streaming proxies must not buffer SSE (`flush_interval -1` in Caddy).

Running amalgam beside corpus, and the one optional reverse proxy that fronts them both, are described in the [ecosystem repository](https://github.com/nullsilver-labs/ecosystem) (its guide assumes the repositories are cloned side by side, so this one sees it as `../ecosystem`).

## Signing in

`APP_PASSWORD` from `.env` is the instance password. Signing in creates a **session row** in the database; the cookie holds 256 random bits and the server stores only its SHA-256. The cookie is `HttpOnly`, `SameSite=Strict`, `Secure` whenever `ORIGIN` is https, and lasts seven days. Sign-in attempts are throttled to ten a minute.

Settings › Access lists every signed-in device with the browser it reported, when it was last seen, and a way to sign it out — which ends that session immediately, wherever it is. Changing `APP_PASSWORD` still signs everyone out at the next restart: the instance remembers a fingerprint of the password it started with and revokes every session when it changes.

### Integration tokens

Scripts get their own keys, never the owner's cookie. Settings › Access creates one with a name, a set of permissions and an expiry of 30, 90 or 365 days or never. The secret is shown once — only its hash is stored — and starts with `amg_`. Send it as `Authorization: Bearer amg_…` to the `/api` routes.

| Scope | Allows |
|---|---|
| `read` | listing and reading conversations and projects, search, export, `GET /api/bootstrap` |
| `write` | creating, renaming, deleting and organising conversations and projects — no model call |
| `generate` | `POST /api/chat` and `POST /api/chat/cancel`; this spends money |
| `admin` | `GET`/`PUT /api/settings` |

A token is never the owner. It works on `/api/*` only, is ignored outright on page routes, and cannot sign in, list or revoke devices, or create another token — those need a browser session. A request without the scope it needs gets 403; a revoked or expired token gets 401.

## What works

- Streaming text chat, stop, saved partial/error responses, and reloadable history.
- Reading your own corpus library: search it from the composer, attach up to five cards to a message, see them quoted with attribution that survives a reload, and be told before excerpts leave this machine. Read-only, server-to-server, only when you ask.
- OpenAI-compatible and native Anthropic adapters, any number of providers from the environment; switching model between turns.
- Conversation rename/delete, keyword search across titles and messages, JSON export.
- Optional projects with shared instructions; deleting a project keeps its conversations.
- Sanitized Markdown with copyable, language-labelled code blocks; response copy; keyboard shortcuts.
- The conversation on a rounded plate, on the page, with a rail down the left edge: the brand tile, then new chat, search and chats at its middle, settings at its foot.
- Several chats open at once. The open chats sit in a strip above the plate, lined up with its edge, from the first chat on; New chat from inside a chat opens a tab of its own (a blank tab is reused); ⌘-click, middle-click or a row's menu opens a chat in a tab of its own. Open tabs survive a reload of the browser tab; closing a tab that is writing stops its response, as closing the page would. On a phone the open chats head the Chats panel instead.
- A Chats panel off the rail grouping conversations by date, pinnable as a sidebar; ⌘K search palette; dark/light/system theme; responsive phone layout.
- Instance settings, saved on the server: a system prompt (empty by default), the context budget in tokens, and the suggestion pills on a new chat. ⌘Enter sends; Enter breaks the line.
- Instance-password sign-in, database-backed sessions you can list and revoke per device, scoped integration tokens for scripts, exact Host and Origin checks, forwarded headers honoured only from configured proxy peers.
- Server-side persistence, migrations, healthchecks, nonroot/read-only application container.
- Drafts and open tabs in this browser tab's session storage; theme, model and layout preferences in local storage. No provider credentials are stored in the browser.

**Not implemented yet:** attachments of your own, ingestion or indexing of anything, vector search inside amalgam, automatic retrieval, web search, images/audio/video, voice, branching/edit/regenerate, durable reconnectable generation jobs, model-account OAuth, agents/MCP, multi-user accounts, document editor, or UI-based connection editing. The corpus connector reads cards you pick; it is not a knowledge base of amalgam's own.

Projects are optional context and organization. They are not required to chat, nor are other project conversations silently added to a request.

## Reading from corpus

```sh
docker network create nullsilver-apps        # once, by you
docker compose -f compose.yaml -f compose.corpus.yaml up -d --build --wait
```

The opt-in overlay attaches **only amalgam's app** to the shared `nullsilver-apps` network — a boundary both applications chose, not corpus's own project wiring. Its database stays on its own private network. It doesn't launch, modify or stop corpus; it never mounts corpus's library or weights. `compose.inference.yaml` does the same for a shared embedder on `nullsilver-inference`, a deliberately separate boundary.

**The token.** Mint one in corpus, with the one scope it needs, and put it in amalgam's `.env`:

```sh
corpus token create "amalgam" --scopes read     # in corpus; the secret is shown once
```

```dotenv
CORPUS_BASE_URL=http://corpus:8787
CORPUS_TOKEN=crp_the-secret-corpus-showed-you
# Optional, only for links you click in a transcript:
CORPUS_PUBLIC_URL=https://corpus.example.com
```

Reaching corpus on a network is not permission to read it. corpus decides that, by the scopes on the token, and it says so in four distinguishable ways: an address that does not answer, a token it does not recognise (401), a token without `read` (403) and a `Host` it will not accept (421, its DNS-rebinding defence — `compose.apps.yaml` on the corpus side allows the name `corpus`). Settings › corpus probes the cheapest read-scoped route and shows whichever of those is true, never a green light for "the address responded".

**What amalgam reads.** Three routes, all of them reads, none of them automatic: `GET /api/status` for that diagnostic, `POST /api/search` when you type in the Sources dialog, and `GET /api/cards/{id}` for the cards you attached to the message you are sending. Up to five cards a message; each is trimmed to 6,000 characters and the set to half the request's context budget, dropping the last one you picked first — “What the model sees” says when anything was cut. The excerpts lead the turn the model is given, framed as quoted reference material; the message stored as yours stays the words you typed, with the sources listed beneath them.

**What it never does.** It never writes to corpus — no capture, no notes, no collections, no edits. It never asks for a scope beyond `read`, never reads a card you did not attach, and never sends `CORPUS_TOKEN` or corpus's raw responses to your browser. Nothing is retrieved in the background: a request to corpus happens when you open the diagnostic, when you search, and when you send a message carrying sources.

**Disclosure.** When sources are attached and the model you chose is not on this machine, the composer says so above it — *Excerpts from your corpus library will be sent to api.example.com* — every time, not once, and not in a setting. A bare service name on a container network, loopback, `host.docker.internal` and private-range addresses count as this machine; a name with a dot in it does not, whatever it ends in. "What the model sees" lists the sources a message carried and where they went.

See the [ecosystem repository](https://github.com/nullsilver-labs/ecosystem) for running both together, and [deployment](docs/DEPLOYMENT.md) for the embedding contract.

## Privacy and deployment limits

This is a **single-user, single-app-instance** release for local/private hosting. The password protects one shared workspace, not multiple tenants. Do not present this as production-ready public SaaS on nullsilver.com yet.

- The web port binds only to `127.0.0.1` unless you change it; PostgreSQL has no host port in any mode.
- Self-hosting keeps storage on your server, but cloud models receive selected conversation context — and, when you attach them, excerpts from your corpus library. The composer names the destination before you send in that case.
- No telemetry or automatic cloud fallback. Credentials and provider URLs are trusted server configuration, not user-submitted proxy targets.
- Beyond loopback, prefer HTTPS. Plain HTTP on a private network is permitted but must be chosen explicitly with `AMALGAM_PRIVATE_HTTP=true`, and it is not a browser secure context. See the hosting table above and the deployment guide.
- Changing `APP_PASSWORD` revokes every session at the next restart.
- Database/backup contents are **not encrypted by this app**. Use disk encryption and protect backups. Per-response context snapshots also contain previous prompt text and project instructions.
- Markdown cannot load remote images or execute scripts. There is no shell, generated-code execution, or tool access.

The server caps input at 16,000 characters and context at the token budget set in Settings (32,000 by default), lowered to a declared model window less the reply's reservation of up to 4,096 tokens; at most 101 recent stored messages are considered. Tokens are **estimated from characters on the conservative side**, not counted by the model's tokenizer, so a model whose window is not declared can still reject an oversized request. Output is capped at 200,000 characters and each generation at three minutes. Failed/partial assistant output is excluded from subsequent model context.

Generation currently lives with the streaming HTTP request. Closing the page cancels it; stop retains received text. Content checkpoints occur about once per second while deltas arrive. A crash can lose the most recent uncheckpointed delta, never silently invent completion. On restart, unfinished responses become `interrupted`. Only one app process/replica is supported. Refresh is not stream resumption; a running response in another tab must be reloaded to see updates.

## Development

```sh
npm ci
node scripts/setup.mjs
# Use your own local PostgreSQL DATABASE_URL in .env.
# ORIGIN must match the dev browser URL, e.g. http://localhost:5173.
npm run dev
npm run check
npm test
npm run build
```

For production Node without Docker, set `DATABASE_URL`, `APP_PASSWORD`, `ORIGIN`, `HOST`, and `PORT`, then `npm run build && npm start`. The startup command loads `.env`; migrations run on first DB access. Do not run dev and production against the same database simultaneously.

### Isolated end-to-end checks (no paid API requests)

```sh
export APP_PASSWORD=amalgam-isolated-test-password
export AMALGAM_BIND_ADDRESS=127.0.0.1 AMALGAM_PORT=18790
export ORIGIN=https://localhost:18793 AMALGAM_TRUSTED_PROXIES=10.89.79.10
export POSTGRES_PASSWORD=amalgam-test-db
# Use this project name so neither real amalgam nor corpus is touched.
docker compose -p amalgam-check -f compose.yaml -f compose.test.yaml up -d --build --wait
npx playwright install chromium
npm run test:e2e
# Deletes only disposable test data, not a real workspace:
docker compose -p amalgam-check -f compose.yaml -f compose.test.yaml down -v
```

The stack runs a Caddy container with a self-signed local certificate at `127.0.0.1:18793`, which rewrites `Host` to the upstream and forwards `X-Forwarded-Host` from a pinned address the app is told to trust. Playwright drives that https origin with `ignoreHTTPSErrors`, so every browser test — streaming included — goes through a proxy and the cookie is `Secure`. The app is also published on `127.0.0.1:18790`, which is where the untrusted-peer tests knock: a direct request with the right `Host` passes, and one with `Host: evil.example` plus a forged `X-Forwarded-Host` is refused.

Both fixtures are explicitly mocks, never a real inference provider and never a real library: `tests/mock-provider.mjs` answers as two model slots — `mock`, a bare service name this app reads as local, and `api.example-cloud.test`, the same container under a name it reads as remote — and `tests/mock-corpus.mjs` answers as corpus, accepting `crp_test_read`, refusing `crp_test_capture` with 403, refusing anything else with 401, and refusing a wrong `Host` with 421.

Browser tests cover sign-in, hosting and forwarded-header boundaries, token scopes and revocation, devices and sign-out across two browsers, real DB persistence, instructions, streaming, cancellation, errors, search, XSS defense, mobile overflow, and the corpus connector: the diagnostic in Settings, attaching a card and seeing it quoted, attributed and still there after a reload, the disclosure line appearing for the remote model and not the local one, and `/api/integrations/corpus/search` answering a `read` token and refusing a `write`-only one. Screenshots land in ignored `test-results/`. Unit tests cover the hosting policy and CIDR matching, credentials and scopes, browser capabilities, provider framing, configuration, context assembly, the corpus diagnosis and connector, source injection and trimming, local-versus-remote destinations, and Markdown.

Pinned selectors the browser suite relies on: `.prose`, `.bubble`, `.turn__sources`, `.attached__chip`, `.composer__disclosure`, `.plate`, `.stage > .plate`, `.rowwrap`, `.search-results`, `.devices li`, `.tokens li`, `.tag--on`. Rename one and the suite tells you.

The suite spends nine of the ten sign-ins the instance allows per minute, deliberately: the throttle is real and the tests live inside it. Wait a minute between consecutive runs. Run test commands in a fresh shell or unset the test exports before starting your real instance.

## Upgrading an existing installation

Two things change on the first start of this version, and nothing else needs doing:

- **Everyone signs in again, once.** Sessions moved from a stateless signature to rows in the database, so old cookies stop being recognised. The `sessions` and `api_tokens` tables are created by the migration that runs on every start; conversations, projects and settings are untouched.
- **If you reach amalgam over plain HTTP at anything but localhost, add `AMALGAM_PRIVATE_HTTP=true` to `.env`** (or switch to `compose.private.yaml`, which sets it). Without it the app answers 503 and says so. HTTPS and localhost installations need no change.

The corpus connector adds one nullable column to `messages` on the same start (`schema_version` 3). It stays dormant until you set `CORPUS_BASE_URL` and `CORPUS_TOKEN`: without both, the Sources control is not shown and no request is made to corpus.

## Data, fonts, and history

Back up the database with `pg_dump`, not by copying its live volume. [Backup/restore instructions](docs/DEPLOYMENT.md#backup-and-restore). Conversation JSON export is portable reading material, not a full backup/import feature.

IBM Plex Mono is bundled under OFL; see `static/fonts/IBM-Plex-OFL.txt`. Satoshi is a separately licensed Fontshare font, **not covered by this repository's MIT license**. Local Satoshi files are git-ignored; obtain your own copy from [Fontshare](https://www.fontshare.com/fonts/satoshi) and place variable upright/italic WOFF2 files at `static/fonts/satoshi-variable.woff2` and `static/fonts/satoshi-variable-italic.woff2`. System sans-serif fallbacks work without them. Do not redistribute the local font-containing image or files without checking the applicable license. The license downloaded during development is included for reference in `static/fonts/Satoshi-FFL.txt`.

This replaces the retired Pi/Telegram personal-agent harness with explicit owner approval. Its code and charter remain available at Git commit `f26cc5a96cf28d7df222c0838318cdf698857b8a`; `.git` and the original application license are preserved. No migration from that old harness is claimed.

[Architecture and roadmap](docs/ARCHITECTURE.md) · [Deployment](docs/DEPLOYMENT.md)
