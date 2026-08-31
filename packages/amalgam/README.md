# @nullsilver/amalgam

A minimal, primitives-first harness for a persistent personal agent: a
directory of plain text, a loop, four tools. Identity, memory and learned
behaviour are markdown files in one git repository at `~/.amalgam`, so you
review what your agent knows with `ls`, `cat` and `git log`. It is built on the
[`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
SDK, version-pinned at `0.84.4`, and it is a consumer of that SDK, not a fork.

See `PROTOCOL.md` for the charter, `NOT.md` for what core will never contain.

## Install and run

Docker is the documented path. From the repository root:

```sh
cp .env.example .env            # put a provider key in it
docker compose build
docker compose run --rm amalgam amalgam init     # once, creates ~/.amalgam
docker compose run --rm amalgam                  # interactive session
```

Other shapes of the same image:

```sh
docker compose run --rm amalgam amalgam run --session nightly "check the workspace"
docker compose run --rm amalgam amalgam doctor
docker compose run --rm amalgam bash             # poke around inside
```

A native install works too (`npm install -g @nullsilver/amalgam`, Node ≥ 22)
but is not the path the documentation follows.

## Mounts

The agent's `bash` sees the container, not your host. Whatever it should be
able to touch has to be mounted in. That is the sandbox, and it is also the
footgun: an unmounted path simply does not exist for the agent. `amalgam
doctor` prints the list when it is running inside a container.

| Host | Container | Why |
|---|---|---|
| `${AMALGAM_HOME:-~/.amalgam}` | `/root/.amalgam` | Identity. A **bind mount**, not a named volume, so `git log` and `git diff` work from the host. Reviewing the agent's memory is the whole point; it must not be trapped inside Docker. |
| `${WORKSPACE:-./workspace}` | `/workspace` | What the agent may touch. The working directory. |
| `./` | `/work` | The repository itself, for developing amalgam with amalgam. |

Git identity comes from `GIT_AUTHOR_*`/`GIT_COMMITTER_*` in `compose.yml`, so
memory commits work without a `~/.gitconfig` in the image. `TZ` is set
explicitly: every "yesterday" depends on it. `.env` is gitignored and its
secrets never enter `~/.amalgam`, which is a git repository.

## CLI

```
amalgam                              interactive session (TUI)
amalgam init                         create AMALGAM_HOME; idempotent, never overwrites
amalgam run --session <name> <text>  one prompt, print the answer, exit
amalgam rpc [--session <name>]       JSONL over stdio, for a gateway
amalgam auth [provider]              list providers, or sign in to one
amalgam doctor                       home, bash timeout, models, mounts
amalgam --help | --version
```

`run` is the cron and sub-agent entry point: it resumes
`~/.amalgam/sessions/<name>.jsonl` if it exists and creates it if it does not,
so the same name tomorrow is the same conversation tomorrow. The agent spawns
sub-agents by calling it from its own `bash`.

| Variable | Default | Meaning |
|---|---|---|
| `AMALGAM_HOME` | `~/.amalgam` | Identity directory |
| `AMALGAM_BASH_TIMEOUT` | `300` | Seconds applied to a `bash` call when the model omits a timeout |

## What is in `~/.amalgam`

```
SOUL.md            identity, loaded into every session
memory/INDEX.md    a pointer file, loaded into every session
memory/*.md        topic files, read on demand
skills/*.md        procedures, listed by description and read when they match
sessions/          conversation logs (gitignored)
auth.json          credentials (gitignored)
```

`amalgam init` also installs a pre-commit hook that refuses to commit staged
content matching common key shapes. Commit with `--no-verify` to override it.

## System prompt

`prompts/system.md` is **1629 characters, ≈453 tokens** (`ceil(chars / 3.6)`),
against a budget of 1000. A test asserts it stays under 700, so the budget
fails loudly rather than drifting. Identity is not in the prompt: it comes from
`SOUL.md`, injected as a context file whose real path is visible in the
assembled prompt.

## Bash always returns

PLAN.md §3.4. A hung `bash` call wastes a human's attention interactively and
permanently kills a cron session or a chat where no human is watching, so:

- **No stdin, no terminal.** Pi spawns children with stdin closed and detached
  from any controlling terminal, verified at the pinned version. A program that
  reads stdin gets EOF; `ssh` cannot open `/dev/tty` for a password prompt.
- **A non-interactive environment,** injected into every spawn and overriding
  the inherited value: `GIT_TERMINAL_PROMPT=0`,
  `GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=10"`,
  `SSH_ASKPASS=/bin/false`, `DEBIAN_FRONTEND=noninteractive`, `PAGER=cat`,
  `GIT_PAGER=cat`, `EDITOR=true`, `CI=1`. Tools then fail fast with an error
  the agent can read and act on. `PATH` and everything else are untouched.
- **A default timeout.** Pi has none. When the model omits `timeout`, amalgam
  applies `AMALGAM_BASH_TIMEOUT` (300s), in every mode. A model-supplied
  timeout always wins, so a long build can still ask for what it needs.
- **One prompt line** telling the agent it has no terminal, to use
  non-interactive flags, and to background long-running work and poll it.

This is configuration of Pi's existing bash tool — `spawnHook` and wrapped
`operations` — not a fifth tool and not a permission layer.

## Development

```sh
npm run build     # tsc
npm run check     # tsc --noEmit
npm test          # vitest; no network, no model
```
