# amalgam

A minimal, primitives-first harness for a persistent personal agent: a
directory of plain text, a loop, four tools (`read`, `write`, `edit`, `bash`).
Identity, memory, and learned behavior are markdown files in one git
repository at `~/.amalgam/` — inspectable with `ls`, `cat`, and `git log`.

Built as a consumer of the [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
SDK, version-pinned. See `PROTOCOL.md` for the charter, `NOT.md` for what core
will never contain, `PLAN.md` for the roadmap.

## Quick start (Docker, the documented path)

```sh
cp .env.example .env        # add an API key
docker compose build
docker compose run --rm amalgam amalgam init   # once: bootstrap ~/.amalgam
docker compose run --rm amalgam                # interactive agent
```

Unattended runs (cron, sub-agents):

```sh
docker compose run --rm amalgam amalgam run --session nightly "check the workspace"
```

Telegram gateway on a VPS: see `packages/telegram/README.md`.

## Mounts — read this before anything else

The agent's `bash` sees the container, not the host. Whatever the agent should
be able to touch must be mounted in. `amalgam doctor` prints what is mounted.

| Mount | Purpose |
|---|---|
| `~/.amalgam` → `/root/.amalgam` | Identity: one git repo (`SOUL.md`, `memory/`, `skills/`). Bind mount so `git log` works from the host — that is the review mechanism |
| `./workspace` → `/workspace` | What the agent may touch. Override with `WORKSPACE=` |
| `./` → `/work` | This repo, for developing amalgam with amalgam |

## Packages

- [`packages/amalgam`](packages/amalgam/) — the harness: `amalgam` CLI
  (interactive, `init`, `run`, `rpc`, `auth`, `doctor`)
- [`packages/telegram`](packages/telegram/) — Telegram gateway: a separate
  process driving `amalgam rpc`; allowlist-gated

Two packages, no more (`NOT.md`).

## Development

```sh
npm install
npm run build && npm run check && npm test
```

Nothing in CI calls a real model.
