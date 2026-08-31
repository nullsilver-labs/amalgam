# amalgam — NOT.md

What core will not contain. Amendments to this file are public and require a
written rationale in the commit that changes it. A third package is a
conversation about this file, not a PR.

## Core will not contain

- **A fifth tool.** `read`, `write`, `edit`, `bash` — that is the whole tool
  surface. Search, fetch, scheduling, messaging: CLIs with READMEs, via `bash`.
- **A permission layer.** No approval prompts, no policy engine, no sandbox of
  our own. The container is the sandbox; exposed transports carry an allowlist.
- **A scheduler or daemon.** OS cron and systemd timers call `amalgam run`.
  Core has no long-running process except the loop the user is talking to.
- **A memory database.** Memory is markdown in a git repository. No embeddings,
  no vector store, no retrieval service. `INDEX.md` is a pointer file the model
  reads; topic files are read on demand.
- **A plugin system.** Pi's extension mechanism exists and we use it privately
  for wiring (context injection, memory commits, bash liveness). We do not
  expose or document a plugin API of our own.
- **Multiple transports in core.** Core speaks stdio. Every other transport is
  a separate process driving `amalgam rpc`, in its own package or elsewhere.
- **A web UI, dashboard, or API server.** `ls`, `cat`, and `git log` are the
  inspection surface.
- **A named persona.** Ships unnamed. Inspiration is documented privately, not
  in public branding.
- **Configuration sprawl.** Environment variables, few of them, documented in
  `.env.example`. No config file format of our own.
- **More than two packages.**

## Why this file exists

Scope creep toward a heavier system is the main failure mode this project is
built to avoid. Making exclusions explicit and amendments public is the
mechanism; the inconvenience is the point.
