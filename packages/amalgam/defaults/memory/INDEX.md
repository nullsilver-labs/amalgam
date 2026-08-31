# Memory index

This file is loaded into every session. Everything else in `memory/` is read
on demand, so this file is what makes the rest reachable.

Keep it a pointer, not a dump: one line per topic file saying what is in it
and when to open it. A line that is interesting on its own belongs in a topic
file instead.

Convention: one topic per file, `memory/<topic>.md`, lowercase and hyphenated.
Newest entries at the top of a topic file. Delete what has gone stale rather
than marking it outdated — `git log` is the history.

## Topics

(none yet)
