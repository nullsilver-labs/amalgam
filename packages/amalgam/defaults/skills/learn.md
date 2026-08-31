---
name: learn
description: Run at the end of a task to decide whether anything learned belongs in memory/ or as a new skill, then record it and prune what is stale. Use when a task is finishing, not while it is in progress.
---

# learn

At the end of a task, once and briefly.

1. **Decide.** Did anything come up that will still matter next week — a fact
   about the user, a decision and the reason for it, a correction to something
   already in `memory/`? Did you work out a procedure worth repeating? Most
   tasks produce nothing, and nothing is the normal answer.

2. **Record.** A fact goes at the top of the matching `memory/<topic>.md`. If
   the topic is new, create the file and add one pointer line to
   `memory/INDEX.md`. A repeatable procedure goes in `skills/<name>.md` with
   frontmatter `name` and a `description` that says when to use it.

3. **Prune.** While the file is open, delete entries that are now wrong or
   stale. Remove them; do not annotate them as outdated.

4. **Commit.** Writes inside `memory/` and `skills/` are committed for you
   with a one-line message. If you changed anything else in `~/.amalgam`,
   commit it yourself, one line, no body.

Then stop. Mention this step only if you wrote something, and then in one line.
