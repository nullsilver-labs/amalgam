import type { Log } from "./log.js";
import type { TelegramApi, TelegramUpdate } from "./telegram-api.js";

const FIRST_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

export interface PollLoopDeps {
  api: TelegramApi;
  /** Fire-and-forget: a turn can take minutes and must not stall the loop. */
  onUpdate: (update: TelegramUpdate) => void;
  log: Log;
  pollSeconds: number;
  /** Loop control for tests and shutdown; defaults to "run forever". */
  keepRunning?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * getUpdates with a rolling offset. Every failure is transient as far as this
 * loop is concerned: it logs, backs off, and tries again, forever. The only
 * way out is the process dying, and the supervisor restarts that.
 */
export async function runPollLoop(deps: PollLoopDeps): Promise<void> {
  const keepRunning = deps.keepRunning ?? (() => true);
  const sleep = deps.sleep ?? defaultSleep;

  // Starting at 0 means a restart still picks up whatever arrived while the
  // gateway was down, within Telegram's retention.
  let offset = 0;
  let backoffMs = FIRST_BACKOFF_MS;

  while (keepRunning()) {
    try {
      const updates = await deps.api.getUpdates(offset, deps.pollSeconds);
      backoffMs = FIRST_BACKOFF_MS;

      for (const update of updates) {
        // Advance first: a message we cannot handle must not be redelivered forever.
        offset = Math.max(offset, update.update_id + 1);
        try {
          deps.onUpdate(update);
        } catch (error) {
          deps.log(`update ${update.update_id} threw: ${describe(error)}`);
        }
      }
    } catch (error) {
      deps.log(`getUpdates failed, retrying in ${backoffMs}ms: ${describe(error)}`);
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
