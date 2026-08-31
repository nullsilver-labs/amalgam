# amalgam — PROTOCOL.md

Status: living charter · started 2026-08-31 · nullsilver-labs

## Purpose

A minimal, primitives-first harness for a persistent personal agent. To Hermes
what Pi is to Claude Code: a directory of plain text, a loop, four tools.
Everything a heavier system ships as a subsystem, amalgam ships as a file the
model can `read`.

## Principles

1. **Files over features.** Identity, memory, and learned behavior are markdown
   files in one git repository (`~/.amalgam/`). If a capability can be a file
   the model reads, it must not be code.
2. **Four tools.** `read`, `write`, `edit`, `bash`. Anything else the agent
   needs is a CLI with a README, reachable through `bash`.
3. **Inspectable with `ls`, `cat`, `git log`.** The user reviews what the agent
   knows the same way they review code. No databases, no opaque state.
4. **A `bash` call always returns.** Children get no stdin and no terminal, and
   unattended modes enforce a default timeout. A hang is a bug, not a hazard.
5. **Consumer of Pi, not a fork.** We build on the
   `@earendil-works/pi-coding-agent` SDK, version-pinned, and we say so.
   Fork triggers are listed in `PLAN.md` §7.
6. **The code is easily understandable by humans.** Any source file can be
   read top to bottom in one sitting by a reviewer who knows TypeScript but
   not Pi. Cleverness that costs readability is a defect.
7. **What core will not contain is public.** See `NOT.md`. Amendments require
   a written rationale in the commit that changes the file.

## Shape

- Two npm packages, no more: `@nullsilver/amalgam` (the harness) and
  `@nullsilver/amalgam-telegram` (a gateway, separate process, RPC client).
- One container image for development and running. The container is the
  sandbox; mounts define what the agent can touch.
- No permission layer in core. Exposed surfaces are gated at the transport
  (allowlist) and by the container.
- System prompt under 1k tokens.

## Pinned versions

| Dependency | Version | Rationale |
|---|---|---|
| `@earendil-works/pi-coding-agent` | `0.84.4` | Verified 2026-08-31: bash children spawn with stdin closed and detached (no `/dev/tty`), the two structural guarantees §3.4 of `PLAN.md` relies on. Bump deliberately; re-verify both on every bump |
| Node | 24 (image), ≥22 (engines) | Current LTS line at time of writing |

## License

MIT, matching Pi. (Open question in `PLAN.md` §8: confirm against the lab's
license page.)
