# @nullsilver/amalgam-telegram

The Telegram gateway: a separate process that long-polls the Bot API and drives
`amalgam rpc --session <name>` over JSONL on stdio. Core is untouched — it still
speaks stdio only, per `NOT.md`.

Zero runtime dependencies: plain `fetch` and node builtins. If this package ever
needs a dependency, that is a conversation about `NOT.md`, not a PR.

## Runbook: a VPS in five commands

```bash
# 1. Get the repo
git clone https://github.com/nullsilver-labs/amalgam.git && cd amalgam

# 2. Fill in the secrets: ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN (from @BotFather),
#    AMALGAM_ALLOWLIST (your numeric Telegram user ID, from @userinfobot)
cp .env.example .env && ${EDITOR:-vi} .env

# 3. Build and start, supervised (restart: unless-stopped)
docker compose -f compose.yml -f compose.gateway.yml up -d --build

# 4. Check the allowlist took effect — this must say what you expect, not "0"
docker compose -f compose.yml -f compose.gateway.yml logs | grep allowlisted

# 5. Watch it work
docker compose -f compose.yml -f compose.gateway.yml logs -f
```

Step 4 is not optional. The gateway refuses to start with an empty allowlist,
so a wrong count means a wrong ID: the bot would then answer nobody, or — if
you edited the wrong line — the wrong somebody.

Then message the bot. An allowlisted account gets a reply; anyone else gets
silence and one line in the log.

## Security model

The allowlist is the first and only gate the gateway itself provides: a sender
whose numeric ID is not in `AMALGAM_ALLOWLIST` has nothing forwarded, receives
nothing at all — not even an error, which would confirm the bot is alive — and
produces one log line. The container is the second layer: the agent's `bash`
sees only what `compose.yml` mounts, so what it can reach is what you decided
to mount. There is no third layer, and we will not add one that pretends to be
one; a Telegram bot wired to a shell is a remote shell, and the honest defence
is a short allowlist and a small container, not a permission dialog nobody
reads.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | Required. From @BotFather. |
| `AMALGAM_ALLOWLIST` | — | Required, non-empty. Comma-separated Telegram user IDs. |
| `AMALGAM_RPC_COMMAND` | `amalgam` | The harness binary to drive. `rpc --session <name>` is appended. |
| `AMALGAM_IDLE_TIMEOUT` | `600` | Seconds of silence before a chat's child process is killed. |

## How it behaves

- **Sessions.** A chat maps to session `telegram-<chat>`; a forum topic maps to
  `telegram-<chat>-<thread>`. That is one file under `~/.amalgam/sessions/`, so
  a fact learned over Telegram is there in the terminal tomorrow.
- **One child per active chat.** Spawned on the first message, killed after the
  idle timeout, respawned on the next one. The session file, not the process,
  is what persists.
- **One prompt in flight per chat.** Messages that arrive mid-turn are queued
  and sent when the previous turn completes. Turns from *different* chats run
  concurrently; the poll loop never waits on the agent.
- **Text only.** Replies are plain text, split at Telegram's 4096-character
  limit on line boundaries where possible, sent in order.
- **It does not stop.** Every `getUpdates` failure is logged and retried with
  backoff, forever. If the process dies anyway, the supervisor restarts it and
  the chats resume their sessions.

## The RPC contract

What this package assumes of `amalgam rpc` (Pi's RPC mode; see `docs/rpc.md` in
`@earendil-works/pi-coding-agent`). Keep these four things and the gateway keeps
working:

- Sends `{"id": "...", "type": "prompt", "message": "..."}`, one line, LF.
- Reads `message_end` events and takes the `text` blocks of assistant messages.
- Treats `agent_settled` as the end of the turn — **not** `agent_end`, which can
  be followed by an automatic retry.
- Treats `{"type": "response", "command": "prompt", "success": false}` as a
  rejected prompt and reports the error.

Framing is strict JSONL: LF only, optional trailing CR stripped. Node's
`readline` is not usable here, because it also splits on U+2028 and U+2029,
which are legal inside JSON strings.

## Source map

| File | What it does |
|---|---|
| `src/main.ts` | Entry point: load config, wire everything, run the loop. |
| `src/config.ts` | The four environment variables, and a readable death without them. |
| `src/allowlist.ts` | Parse and check user IDs. Empty means deny all. |
| `src/session-name.ts` | chat + thread → session name. |
| `src/poll-loop.ts` | `getUpdates` with a rolling offset and backoff that never gives up. |
| `src/gateway.ts` | One update → allowlist → session → agent → replies. |
| `src/telegram-api.ts` | `getUpdates` and `sendMessage` over plain `fetch`. |
| `src/split-message.ts` | Split a reply at Telegram's length limit. |
| `src/rpc-protocol.ts` | JSONL framing and turn accumulation. Pure functions. |
| `src/rpc-child.ts` | One child: prompt queue, one turn in flight, death. |
| `src/rpc-pool.ts` | One child per session, idle timeout, respawn. |
| `src/spawn-rpc.ts` | The only file that spawns a process. |

## Development

```bash
npm run build     # tsc → dist/
npm test          # vitest; no network, no child processes
npm run check     # types only
```

The tests use injected fakes for the Telegram API, the child process, and the
clock, so nothing in CI reaches the network or spawns the harness. To try the
real plumbing without a real agent, point `AMALGAM_RPC_COMMAND` at a script that
speaks the four events above.
