# Deployment

This guide is amalgam's own. The shared hosting rules both Nullsilver applications keep, and the one optional reverse proxy that can front them, live in the [ecosystem repository](https://github.com/nullsilver-labs/ecosystem).

## The three hosting modes

An origin tells the app its address. Authentication decides who may use it. Exposure configuration decides whether HTTP is acceptable at all. These are three separate settings on purpose: nothing here infers safety from an address that happens to look private.

| Mode | Transport | Default exposure | Overlay |
|---|---|---|---|
| Local machine | HTTP allowed | loopback only | none — `compose.yaml` |
| Private LAN / VPN | HTTPS preferred; HTTP **explicitly** allowed | one selected interface | `compose.private.yaml` |
| Public-facing | HTTPS required | behind a reverse proxy you run | `compose.proxied.yaml` |

```sh
docker compose up -d --build --wait                                            # local
docker compose -f compose.yaml -f compose.private.yaml up -d --build --wait    # private
docker compose -f compose.yaml -f compose.proxied.yaml up -d --build --wait    # proxied
```

| Variable | Meaning |
|---|---|
| `HOST`, `PORT`, `AMALGAM_BIND_ADDRESS`, `AMALGAM_PORT` | where the process and the published port bind |
| `ORIGIN` | the exact browser address. An address only: it switches no security behaviour |
| `AMALGAM_PRIVATE_HTTP` | `true` to accept an `http://` ORIGIN whose host is not loopback. Without it every request but `/api/health` answers 503 and names the variable. With it, startup logs one WARNING |
| `AMALGAM_TRUSTED_PROXIES` | comma-separated IPs or CIDRs, v4 or v6. Only from these socket peers are `X-Forwarded-Host` (first value) and `X-Forwarded-Proto` read. Empty means nobody's |

No TLS is needed between containers on a deliberately private network; authentication is always needed. A VPN encrypts traffic but does not make an HTTP page a browser secure context, so the clipboard API and microphone stay unavailable there — Settings › Access reports that honestly rather than failing silently.

### Proxy trust

The socket peer is the only thing a request cannot forge, so it is what the decision rests on. `event.getClientAddress()` is compared against `AMALGAM_TRUSTED_PROXIES`; adapter-node's `ADDRESS_HEADER`, `HOST_HEADER` and `PROTOCOL_HEADER` are deliberately left unset so that address stays the real TCP peer. Headers from an untrusted peer are ignored — not an error, simply not listened to — so publishing the app's port beside the proxy is safe: a direct request forging `X-Forwarded-Host` is refused by the ordinary Host check.

Prefer a proxy that preserves the browser's `Host`; then no forwarded header is needed at all. Whichever you use, streaming must not be buffered (`flush_interval -1` in Caddy).

## Access

Sessions are rows in `sessions`: the cookie is 256 random bits, the database keeps only its SHA-256, and each row carries a device label derived server-side from the User-Agent, `created_at`, `last_seen_at` (written at most once a minute), `expires_at` and `revoked_at`. Settings › Access lists them and revokes any one; revoking the current one is signing out. Changing `APP_PASSWORD` revokes them all at the next restart, through a `password_fingerprint` row in `settings`.

Integration tokens are rows in `api_tokens`, prefix `amg_`, with explicit scopes (`read`, `write`, `generate`, `admin`), an optional expiry and `last_used_at`. They are accepted on `/api/*` only and ignored on page routes. Creating, listing and revoking them requires a browser session, so a token can never mint another. Cookie-authenticated writes must carry a same-origin `Origin` header; bearer requests are exempt, because presenting a secret is itself the proof of intent that a cookie is not.

## Standalone

`compose.yaml` runs a nonroot/read-only Node app and a PostgreSQL database. Only the app is published, on loopback port 8790. The private database network is internal; the app also has an egress-capable network to contact configured providers. `.env` is excluded from Git and Docker build context, but injected secrets are still visible to administrators with Docker access.

Run setup, configure providers, then `docker compose up -d --build --wait`. The DB healthcheck gates app startup; the application healthcheck performs a DB round trip. It deliberately uses Node's HTTP client with an explicit Host header because recent fetch implementations may ignore Host overrides.

Default app origin is exactly `http://localhost:8790`, not `http://127.0.0.1:8790`. Set `ORIGIN` if using another address/port. Browser-facing Host must match it. Health probes should also supply that Host. Changing the bind port requires updating both `AMALGAM_PORT` and `ORIGIN`.

Never share one DB between dev and production or multiple app replicas. Startup recovery treats unfinished messages as interrupted. A single-user application password is required even on loopback. Use a long random value; sign-in attempts are globally throttled to ten per minute in the app process. This is a local defense, not a public-service abuse-control system.

## Model catalogs and manual overrides

For an OpenAI-compatible provider, configure its `*_BASE_URL` and `*_API_KEY` (optional only for keyless services). Use the API base including `/v1` or the vendor's equivalent. `OPENAI_BASE_URL` defaults to `https://api.openai.com/v1`; hosted OpenAI and Anthropic slots require a key before they are enabled. Extra slots also need their names in `PROVIDERS`; see `.env.example`.

Empty or omitted `*_MODELS` enables server-side `GET <base>/models` for OpenAI-style slots on authenticated bootstrap/chat requests. No startup generation, paid completion probe, background polling, unconfigured-provider probing or automatic provider fallback occurs. Keys stay upstream; browser requests cannot supply a provider URL. Redirects are refused rather than forwarding credentials, and failed authentication is never retried without a key.

Catalog reads have a five-second total deadline, a 4 MiB body ceiling and a 2,000-entry limit. Malformed/oversized answers and non-2xx responses become provider-specific feedback in Settings › Models, not a workspace failure. Successful results are cached in memory for five minutes, failures for 30 seconds; concurrent callers share one request. Reload after expiry to retry. Failed refreshes preserve the last successful list, clearly marked stale, until a successful refresh, configuration change or restart. A successfully refreshed list may remove IDs. Missing selections remain visibly unavailable, including after a cold-cache failure or browser reload; amalgam never substitutes another model/provider. Sending is disabled until the selected ID returns or you explicitly choose an available replacement.

A nonempty comma-separated `*_MODELS` list is an authoritative override: discovery for that slot is disabled and the list works offline. Use it for APIs without `/models`, to restrict non-chat catalog entries, or to declare known context windows (`model-id:32k`). **Anthropic requires this manual list.** Discovered context windows stay unknown; the instance budget applies and may exceed the model's actual limit. Listing is not proof of chat compatibility or generation permission, and manual configuration is not a connection test.

After editing the server environment, recreate only the app with the deployment's existing Compose files (base example: `docker compose up -d --no-deps --wait app`); restarting an existing container alone does not update its environment. Protect the environment file and do not weaken authentication or expose a keyless inference endpoint to solve a catalog failure.

## Optional corpus and inference networks

```sh
docker network create nullsilver-apps        # once; corpus <-> amalgam
docker network create nullsilver-inference   # once; a shared embedder
docker compose -f compose.yaml -f compose.corpus.yaml config --quiet
docker compose -f compose.yaml -f compose.corpus.yaml up -d --build --wait
```

The overlays require those pre-existing external networks and join **only the app**; the database keeps its own internal network. Names are overridable with `APPS_NETWORK` and `INFERENCE_NETWORK`. amalgam never joins corpus's own project network: a shared, named integration network is a boundary both applications chose, whereas `corpus_default` is corpus's private wiring. No models container, model volume, corpus DB or library mount, service restart, or shared application database.

Defaults inside those networks:

- corpus API: `http://corpus:8787`, with `CORPUS_TOKEN` from `.env`
- Embedding API: `http://embedder:8788/v1` (OpenAI-compatible `/embeddings` route)

The embedding address is still configuration only; nothing calls it yet. The corpus address is called, on request, by the read-only connector below. The two networks are separate on purpose — sharing a model server is a narrower thing to allow than sharing an application API, and the boundaries should move independently.

### Connecting to corpus already behind Caddy

Keep the existing corpus route and browser origin. A shared Docker network is optional: if amalgam can reach corpus's existing HTTPS hostname, use it directly in amalgam's `.env`:

```dotenv
CORPUS_BASE_URL=https://corpus.example.com
CORPUS_TOKEN=crp_REPLACE_WITH_A_READ_SCOPED_TOKEN
CORPUS_PUBLIC_URL=https://corpus.example.com
```

Mint the token in the existing corpus deployment (`corpus token create "amalgam" --scopes read`); do not recreate corpus using different Compose files just to obtain a token. Neither URL includes `/api`. Preserve the rest of amalgam's `.env`, including passwords and model-provider settings, then recreate the app with its existing Compose configuration. With the base deployment:

```sh
docker compose up -d --build --no-deps --wait app
```

No `compose.corpus.yaml`, extra allowed service host, shared library mount, or CORS change is needed for this HTTPS path. The proxy must pass the bearer Authorization header and API requests through rather than intercepting them with another login page. Settings → corpus → Check now verifies authentication as well as reachability.

Publishing amalgam itself is a separate step: add its own DNS record and Caddy site, set its HTTPS `ORIGIN`, and publish its port on an interface Caddy can reach (see below). If a DDNS script maintains your home IP, add amalgam's hostname to that script too. Some updaters only update existing records: create the initial A record separately and verify its proxy setting. Keep existing corpus DNS and proxy settings unchanged.

### The corpus connector

| Variable | Meaning |
|---|---|
| `CORPUS_BASE_URL` | the corpus API's address, e.g. `http://corpus:8787`. Empty disables the connector entirely |
| `CORPUS_TOKEN` | a bearer token minted in corpus with the `read` scope and nothing more: `corpus token create "amalgam" --scopes read`. Server-side only; it never reaches a browser |
| `CORPUS_PUBLIC_URL` | optional. The address *you* open corpus at, used only to link the sources listed under a message. A service name on a Docker network is not one; leave it empty and those stay plain text |

Both of the first two are needed before the connector reports itself configured, before the Sources control appears in the composer, and before any request is made — an address with no token would only produce 401s.

amalgam calls exactly three corpus routes, all reads, none on a schedule:

| Route | When |
|---|---|
| `GET /api/status` | the diagnostic in Settings › corpus, cached in memory for 30 seconds; "Check now" asks again |
| `POST /api/search` | while you type in the Sources dialog |
| `GET /api/cards/{id}` | for the cards attached to the message you are sending, once, before it is stored |

Nothing is written to corpus, no scope beyond `read` is ever requested, no card is fetched that you did not attach, and neither the token nor corpus's own response bodies are passed to the browser — the routes copy out a fixed set of fields and drop the rest. Requests time out at five seconds (probe and search) and ten (a card), and response bodies are read only up to a ceiling.

Reachability is not authorisation, and the diagnostic keeps them apart: `unreachable` (no answer), `unauthenticated` (401, a token corpus does not know), `forbidden` (403, a token without `read`), `wrong_host` (421, corpus's DNS-rebinding defence — put the service name in `CORPUS_SERVER__EXTRA_ALLOWED_HOSTS` on the corpus side, which its `compose.apps.yaml` does for the name `corpus`), `rate_limited` (429) and `error`. Each carries one sentence naming what to change.

A message that carries sources quotes them ahead of your text, framed as reference material; the stored message stays your own words, with a `sources` column recording which cards were quoted and how many characters of each. When the chosen model's destination is not this machine, the composer says where the excerpts are going before you send — every time.

### Shared embedding contract

The inspected corpus configuration uses `LiquidAI/LFM2.5-Embedding-350M`, GGUF Q8, CLS pooling, 1024-dimensional L2-normalized vectors and cosine similarity. Input prefixes are mandatory:

- Query: `query: {text}`
- Passage: `document: {text}`

Effective context is 512 tokens per slot. Chunk conservatively around 450 tokens with tokenizer-based enforcement; character count is not a token guarantee. corpus's server runs two parallel slots in a 1024-token total context. amalgam bulk ingestion must use bounded concurrency/backpressure so it doesn't starve corpus search.

Keep separate indices, stable embedding-set metadata including model/version/dimensions/prefix/pooling/normalization/chunker, and re-embed on contract changes. Probe for the known degenerate identical-vector failure on incompatible llama.cpp builds; don't silently switch pooling or models. Sharing endpoint residency avoids duplicate memory/weights, not embedding computation or license obligations. Check the model's applicable license/revenue conditions before public/commercial deployment.

## Direct LAN access

Set the interface to publish on, the exact address you will type, and the opt-in:

```dotenv
AMALGAM_BIND_ADDRESS=192.168.1.10
AMALGAM_PORT=8790
ORIGIN=http://192.168.1.10:8790
AMALGAM_PRIVATE_HTTP=true
```

`compose.private.yaml` sets the last one for you. Replace the example IP with your server's LAN IP, run the private-mode command above, and open that origin from another LAN machine. The Host and Origin checks remain enabled. `AMALGAM_BIND_ADDRESS` controls Docker's host-side publish address; the container's internal `HOST=0.0.0.0` is unchanged. The database stays private.

Prefer a specific LAN interface to `0.0.0.0`, which publishes on every IPv4 interface. Plain HTTP sends your password and conversations without transport encryption; the opt-in exists so that is a decision rather than an accident, and startup logs one warning to keep it visible. No firewall, router forwarding, or public exposure is configured automatically.

## Private remote access / TLS

For remote access, use an SSH tunnel, or a trusted VPN, or a TLS reverse proxy. Do not change an existing corpus or Caddy configuration automatically. A separately approved Caddy route looks like this:

```caddyfile
amalgam.example.com {
  reverse_proxy 127.0.0.1:8790 {
    flush_interval -1
  }
}
```

When Caddy bind-mounts a single config file, an editor's atomic save can leave its running container reading the old inode. Validate the new host file via a temporary copy in the container, then recreate the Caddy container to refresh the mount; a plain reload of the stale mounted path will not apply your edit. Retain certificate volumes, and account for the brief interruption to other proxied services.

This example assumes Caddy runs on the host and can reach loopback. A containerized Caddy needs an explicitly shared network or a host-published port instead; its `127.0.0.1` is not the host. This route preserves the incoming `Host`, so nothing more is needed: set `ORIGIN=https://amalgam.example.com` and recreate the app. If your proxy rewrites `Host`, it must send `X-Forwarded-Host`, and you must name it in `AMALGAM_TRUSTED_PROXIES` — that is the only way the app will read the header. With an https origin the session cookie is `Secure`. Streaming proxies must not buffer SSE.

The isolated test stack does exactly this awkward case on purpose: `tests/Caddyfile` rewrites `Host` to the upstream and forwards `X-Forwarded-Host`, from a container pinned to one address that `AMALGAM_TRUSTED_PROXIES` names, so the browser suite exercises the trusted-forwarding path end to end.

No public multi-tenant service is implemented. No automatic edits to nullsilver.com DNS, TLS, firewall, Caddy, or corpus are part of this build.

## Backup and restore

All current application data is in PostgreSQL; there is no asset directory yet. Stop generating before backup if you want only terminal responses. A DB snapshot includes context snapshots, instructions, and messages. Encrypt backups and preserve `.env` separately in a secret store.

```sh
# In the real amalgam directory, using its real environment/project.
# Back up to a new, protected file (don't overwrite an existing backup).
umask 077
docker compose exec -T db pg_dump -U amalgam -d amalgam -Fc > amalgam-backup.dump
```

To restore into an explicitly chosen EMPTY amalgam database (never corpus or an active workspace):

```sh
docker compose stop app
docker compose exec -T db pg_restore -U amalgam -d amalgam --no-owner --no-privileges --exit-on-error < amalgam-backup.dump
docker compose up -d app
```

This intentionally does not `--clean` or drop an existing DB. Provision a separate empty DB/volume for restoration, verify content and schema before replacing anything, and keep the original backup. Changing `POSTGRES_PASSWORD` in `.env` alone does not change the password inside an initialized database; rotate the DB role explicitly or restore into a fresh instance.

`docker compose down` preserves data. **`down -v` destroys the stack's database volume** and is only appropriate for the named disposable test stack in the test instructions.

## Validation and known dependency note

The isolated test stack uses a clearly labeled mock provider and its own DB volume, network, ports and TLS proxy. It sends no real API requests and never joins corpus's network. The corpus and inference overlays can be statically validated with `docker compose … config --quiet` without touching anything that is running.

At initial build, npm audit reports a low-severity transitive `cookie <0.7` advisory through SvelteKit/adapter-node. Session cookie names, paths, and attributes here are fixed constants; no untrusted cookie names/paths are passed to serialization. Keep tracking upstream updates; don't use npm's proposed force-downgrade to an obsolete SvelteKit release. This is not a claim of a clean security audit or public-hosting readiness.
