# amalgam — PLAN.md

Status: draft · 2026-08-31 · nullsilver-labs
Companion documents: `PROTOCOL.md` (charter), `NOT.md` (what core will not contain)

## 0. What we are building

A minimal, primitives-first harness for a persistent personal agent. To Hermes what Pi is to Claude Code: a directory of plain text, a loop, four tools. Everything Hermes ships as a subsystem, amalgam ships as a file the model can `read`.

Success looks like: a fresh machine reaches a persistent identity in under a minute, the agent recalls yesterday without being told to, and the whole system is inspectable with `ls`, `cat`, and `git log`.

## 1. Decisions locked

| Area | Decision |
|---|---|
| Name / home | `amalgam`, repo `nullsilver-labs/amalgam`, npm `@nullsilver/amalgam`, home `~/.amalgam/` |
| Runtime | TypeScript on Node, built on `@earendil-works/pi-coding-agent` SDK, version-pinned |
| Tools | Exactly four: `read`, `write`, `edit`, `bash`. Everything else is a CLI with a README |
| System prompt | Under 1k tokens: identity, file locations, when to consult `learn.md` |
| Identity | `~/.amalgam/` is one git repo: `SOUL.md`, `memory/`, `skills/`, `sessions/` (gitignored) |
| Memory | Markdown. `memory/INDEX.md` loaded at start; topic files read on demand. Agent commits; user reviews with git |
| Learning | `skills/learn.md` at task end, prompt-triggered. Optional extension automates it. No daemon |
| Scheduling | None in core. OS cron / systemd timers call `amalgam run` |
| Sub-agents | `bash` spawns `amalgam` in print mode with a fresh session |
| Compaction | Pi's built-in. Durable state is in files, not context |
| Transport | `(channel, sender, thread, text)` → reply. Core: stdio only. Telegram is a separate process over RPC mode |
| Security | No permission layer in core. Exposed surfaces gated at the transport (allowlist) and by the container |
| Environment | **Docker by default**, for development and for running. Native install remains supported but is not the documented path |
| Bash liveness | A `bash` call must always return. Pi already closes stdin and detaches children (no `/dev/tty`); amalgam adds a non-interactive environment and a default timeout in unattended modes. See §3.4 |
| Persona | Ships unnamed. Detached, dry, non-protagonist narrator stance; self-negation capped. Inspiration documented privately, not in public branding |
| License | MIT to match Pi, pending check against the lab's license page |

## 2. Repository layout

```
amalgam/
├── PROTOCOL.md            charter (lab house format)
├── NOT.md                 what core will not contain; amendments are public
├── PLAN.md                this file
├── Dockerfile
├── compose.yml            one service: the dev/run container
├── compose.gateway.yml    VPS overlay: same image, gateway command (M3)
├── .env.example           API keys, TELEGRAM_BOT_TOKEN, TZ, AMALGAM_ALLOWLIST
├── package.json           npm workspaces
└── packages/
    ├── amalgam/           the harness (v0: Pi package; v1: own CLI)
    │   ├── src/
    │   ├── prompts/system.md
    │   ├── defaults/      SOUL.md, memory/INDEX.md, skills/learn.md
    │   └── README.md
    └── telegram/          gateway (M3)
        ├── src/
        └── README.md
```

Two packages only. A third package is a `NOT.md` conversation, not a PR.

## 3. Environment: the container

### 3.1 Why a container by default

Managing Node versions, Pi versions, CLI tools, and the identity directory across machines is exactly the kind of drudgery we do not want to spend volunteer time on. One image, one compose file, same behavior on a laptop and a €5 VPS.

The consequence to keep in mind: the agent's `bash` sees the container, not the host. Whatever the agent should be able to touch is mounted in. This is a feature (the container is the sandbox) and a footgun (forgot to mount it → the agent can't see it). Document mounts prominently.

### 3.2 Dockerfile (sketch)

```dockerfile
FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ripgrep curl ca-certificates tini openssh-client \
    && rm -rf /var/lib/apt/lists/*
# Pinned. Bump deliberately; see fork triggers.
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent@<PINNED>
WORKDIR /work
COPY . /work
RUN npm ci && npm run build && npm link ./packages/amalgam
ENV AMALGAM_HOME=/root/.amalgam
ENTRYPOINT ["tini", "--"]
CMD ["amalgam"]
```

Bake in only what the agent will reach for through `bash`: git, ripgrep, curl, ssh. Anything else is a CLI-with-README installed into the workspace or added to the image in a separate, deliberate commit.

### 3.3 compose.yml (sketch)

```yaml
services:
  amalgam:
    build: .
    stdin_open: true
    tty: true
    env_file: .env
    environment:
      TZ: ${TZ:-Europe/Rome}
      GIT_AUTHOR_NAME: amalgam
      GIT_AUTHOR_EMAIL: amalgam@localhost
      GIT_COMMITTER_NAME: amalgam
      GIT_COMMITTER_EMAIL: amalgam@localhost
    volumes:
      - ${AMALGAM_HOME:-~/.amalgam}:/root/.amalgam   # identity: bind mount so host git works
      - pi-home:/root/.pi                            # Pi packages/auth persist across rebuilds (v0)
      - ${WORKSPACE:-./workspace}:/workspace         # what the agent may touch
      - ./:/work                                     # the repo, for developing amalgam itself
    working_dir: /workspace
volumes:
  pi-home:
```

Usage:

```
docker compose build
docker compose run --rm amalgam                       # interactive terminal agent
docker compose run --rm amalgam amalgam run --session nightly "check the workspace"
docker compose run --rm amalgam bash                  # poke around
```

Design notes:
- `~/.amalgam` is a **bind mount**, not a named volume, so `git log` and `git diff` work from the host. That is the review mechanism; it must not be trapped inside Docker.
- Git identity is set via environment so memory commits work without a `~/.gitconfig` in the image.
- `TZ` is set explicitly. Every "yesterday" and every cron-style behavior depends on it.
- `.env` is gitignored. Secrets never enter `~/.amalgam`, which is a git repo.
- The gateway (M3) uses the same image with `compose.gateway.yml` overriding `command` and adding `restart: unless-stopped`. Still one running service per deployment.

### 3.4 Non-interactive bash: a call must always return

The failure we refuse: the agent runs `ssh` (or `git push` to an authenticated remote, or anything that asks a question) and sits forever waiting for terminal input that will never arrive. In interactive mode that wastes a human's attention; in `amalgam run` and RPC mode there is no human, and one hang kills a cron session or a Telegram chat permanently.

What Pi already guarantees (verified in `0.84.4`, `core/tools/bash.js`):
- **Stdin is closed.** Children are spawned with stdin ignored or EOF'd immediately, so anything that reads stdin gets EOF at once instead of blocking.
- **No controlling terminal.** Children are `detached` (a new session on Linux), so prompts that open `/dev/tty` directly — `ssh`'s password prompt — fail immediately instead of waiting.
- **Per-call timeout and abort.** The tool takes an optional `timeout` (kills the whole process tree), and interactive mode lets the user abort.

What Pi does **not** do, and amalgam adds via the bash tool's `spawnHook` / `operations` options (no fork needed):
- **Non-interactive environment**, injected into every `bash` spawn: `GIT_TERMINAL_PROMPT=0`, `GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=10"`, `SSH_ASKPASS=/bin/false`, `DEBIAN_FRONTEND=noninteractive`, `PAGER=cat`, `GIT_PAGER=cat`, `EDITOR=true`, `CI=1`. Tools then fail fast with a readable error ("Permission denied", "terminal prompts disabled") the agent can act on, instead of hanging.
- **Default timeout when nobody can abort.** Pi has *no* default; a command blocking on anything other than stdin (`tail -f`, a dev server, a lock) runs forever. Amalgam applies a default (`AMALGAM_BASH_TIMEOUT`, default 300s) whenever the model omits one. In `run` and `rpc` modes the default is mandatory; interactively the model may pass a longer explicit timeout when it has a reason.
- **One system-prompt line** telling the agent that commands run without a terminal, to use non-interactive flags, and to background long-running processes (`... &`, then poll).

This lives in `packages/amalgam/src` as a small wrapper around Pi's bash tool factory — it is configuration of an existing hook, not a fifth tool and not a permission layer.

## 4. Milestones

Estimates assume one person, part time. Each milestone ends with an exit test that is run inside the container.

### M0 — Bootstrap (days 1–2)

- [ ] Create repo with layout above; npm workspaces; TypeScript config shared across packages
- [ ] Write `PROTOCOL.md` and `NOT.md` from the recap; commit them first
- [ ] `Dockerfile`, `compose.yml`, `.env.example`, `.gitignore` (`.env`, `workspace/`)
- [ ] Pin Pi version; record it in `PROTOCOL.md` (`0.84.4` is current as of 2026-08-31 and is what §3.4's guarantees were verified against)
- [ ] Minimal CI: build, lint, `docker compose build`

Exit: `docker compose run --rm amalgam pi --version` prints the pinned version.

### M1 — v0: a Pi package (week 1)

Deliver the thesis with zero infrastructure of our own. `packages/amalgam` is an installable Pi package.

- [ ] `prompts/system.md`, under 1k tokens; measure and record token count in the README
- [ ] `defaults/`: `SOUL.md` (unnamed persona), `memory/INDEX.md`, `skills/learn.md`
- [ ] One extension: on `agent_start`, read `SOUL.md` and `memory/INDEX.md` into the system prompt; register `~/.amalgam/skills` with the resource loader. Registers no tools, no commands
- [ ] `scripts/init.sh`: create `~/.amalgam`, copy defaults, `git init`, write `.gitignore` (`sessions/`, `auth.json`)
- [ ] `learn.md`: at task end, decide whether anything belongs in memory or as a new skill; if so, `edit` the file and commit with a one-line message. Nothing else
- [ ] README: install in one command inside the container: `pi install git:github.com/nullsilver-labs/amalgam`

Exit:
1. Fresh container + `init.sh` + `pi` → agent introduces itself from `SOUL.md`. Under one minute.
2. Tell it a fact, end session, start a new session next day → it uses the fact unprompted.
3. `git log` in `~/.amalgam` shows the commit the agent made, with a sensible message.

### M2 — v1: our own CLI (weeks 2–3)

Replace the `pi` binary with `amalgam`, still on the SDK. No fork.

- [ ] `amalgam` (interactive): `createAgentSession()` with a custom `ResourceLoader` rooted at `AMALGAM_HOME`; `tools: ["read", "write", "edit", "bash"]`; `SessionManager` writing to `~/.amalgam/sessions/`
- [ ] Bash liveness wrapper per §3.4: non-interactive env via `spawnHook`, default timeout when the model omits one (mandatory in `run`/`rpc`), system-prompt line
- [ ] `amalgam init`: replaces `init.sh`
- [ ] `amalgam run --session <name> "<prompt>"`: print mode, resumes or creates the named session, exits. This is the cron and sub-agent entry point
- [ ] `amalgam rpc`: JSONL over stdio, for the gateway
- [ ] `ModelRuntime` with `authPath`/`modelsPath` under `~/.amalgam`; `amalgam auth <provider>`
- [ ] Memory commit helper: after any `edit`/`write` inside `~/.amalgam/memory` or `skills`, stage and commit (implemented as an extension hook, not a tool)
- [ ] Optional extension `learn-auto`: hook turn end to invoke `learn.md`; off by default
- [ ] Container `CMD` becomes `amalgam`; `pi-home` volume no longer needed

Exit:
1. All M1 exit tests pass with `pi` uninstalled from the image.
2. A cron line inside the container (`amalgam run --session nightly "…"`) produces a memory commit overnight.
3. `amalgam run` spawned from the agent's own `bash` completes a sub-task and returns its output.
4. `amalgam run --session t "ssh into example.com and report what you find"` terminates on its own with a readable failure — no hang, no manual kill.

### M3 — v2: Telegram gateway (weeks 4–5)

`packages/telegram`. A separate process; core untouched.

- [ ] Long-poll `getUpdates`; plain `fetch`, zero dependencies
- [ ] Allowlist from `AMALGAM_ALLOWLIST` (Telegram user IDs), checked before anything is forwarded. Unknown senders receive nothing, not even an error
- [ ] Session map: `chat_id` + `message_thread_id` → `~/.amalgam/sessions/telegram-<chat>-<thread>.jsonl`
- [ ] Drive `amalgam rpc` (one long-lived child per active chat, idle timeout); queue: one in-flight message per chat
- [ ] Reply via `sendMessage`; split at Telegram's length limit; text only
- [ ] `compose.gateway.yml`: same image, `command: amalgam-telegram`, `restart: unless-stopped`, no `tty`
- [ ] Runbook: VPS deployment in five commands

Exit:
1. Round trip from an allowlisted account; a non-allowlisted account gets silence and a log line.
2. A fact learned over Telegram is used in the terminal the next day (same `~/.amalgam`).
3. Kill the gateway mid-conversation; supervisor restarts it; the chat resumes its session.

### M4 — Harden and release (week 6)

- [ ] Tests: prompt assembly (token budget), session mapping, allowlist, commit helper. Use a fake provider or recorded fixtures; no live model in CI
- [ ] Secret scan pre-commit hook on `~/.amalgam` (installed by `amalgam init`)
- [ ] `PROTOCOL.md` reconciled with what was actually built; `NOT.md` reviewed
- [ ] Publish `@nullsilver/amalgam@0.1.0` and `@nullsilver/amalgam-telegram@0.1.0`
- [ ] Lab writeup per house convention: what was left out and why

Exit: someone who has never seen the repo deploys the gateway on a VPS from the runbook alone.

## 5. Testing strategy

- **Unit** (per package, fast, no network): system prompt stays under budget; identity directory bootstraps correctly; session naming; allowlist; message splitting; bash wrapper injects the non-interactive env and applies the default timeout when the model omits one.
- **Harness** (container, fake provider): full turn through `amalgam run` with a scripted model that emits a known tool call; asserts on the resulting memory commit. One case emits a would-hang command (`read x`, `ssh` to a password-only host) and asserts the turn completes within the default timeout.
- **Acceptance** (manual, per milestone): the numbered exit tests above. They are the definition of done and are re-run before each release.

Nothing in CI calls a real model. Real-model runs are manual and their sessions are kept as fixtures where useful.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Pi upstream changes break us or add things `NOT.md` rejects | Version pin; fork triggers below; upgrade Pi as a deliberate PR with the exit tests re-run |
| Scope creep toward Hermes | `NOT.md` amendments are public and require a written rationale; two packages maximum |
| Container mounts confuse users ("the agent can't see my files") | Mount table front and center in README; `amalgam doctor` prints what is mounted |
| Secrets leak into the git-tracked identity dir | `.env` only; `sessions/` and `auth.json` gitignored; pre-commit secret scan |
| Telegram exposure = remote shell | Allowlist first, container second, no third layer pretending to be one |
| A `bash` call hangs and silently kills a cron session or chat | §3.4: Pi closes stdin and detaches children (verified at the pin); amalgam adds non-interactive env + default timeout in unattended modes. Re-verify the stdin/detach behavior on every Pi bump |
| Persona drifts into self-negation loops | `SOUL.md` states the cap explicitly; acceptance test includes a "be brief and confident" check |
| Stale memory causes odd behavior | `learn.md` includes pruning; `INDEX.md` is a pointer file, not a dump |

## 7. Fork triggers

Fork Pi (in TypeScript) only if one of these is true and cannot be worked around:

1. Upstream adds core features that contradict `NOT.md` and we are carrying patches to remove them.
2. The loop must block on an inbox rather than a prompt, and neither extensions nor RPC mode can express it.
3. Identity-directory context assembly needs semantics the `ResourceLoader` cannot provide.

Until then, we are a consumer of Pi's SDK, and we say so.

## 8. Open questions

- License: confirm MIT against the lab's license page.
- Shell alias for `amalgam` (`am`? `amg`?): decide at M2, document, do not ship a second binary.
- Whether `workspace/` defaults to the repo's own directory during development (dogfooding: amalgam edits amalgam).
- Whether `amalgam rpc` children are per chat or one shared process with session switching. Decide from real load at M3, not in advance.

## 9. Definition of "minimal", so we can check ourselves

At any release, all of the following must be true:

- Four tools, no more.
- System prompt under 1k tokens.
- `NOT.md` unchanged since last release, or changed with a public rationale.
- Two packages.
- Everything the agent knows is a file you can open in a text editor.
- The code is easily understandable by humans: any source file can be read top to bottom in one sitting, and a reviewer who knows TypeScript but not Pi can follow it. Cleverness that costs readability is a defect.
