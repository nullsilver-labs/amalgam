import type { Allowlist } from "./allowlist.js";
import type { Log } from "./log.js";
import { sessionName } from "./session-name.js";
import { splitMessage } from "./split-message.js";
import type { TelegramApi, TelegramUpdate } from "./telegram-api.js";

/** What the gateway needs from the child pool. */
export interface Asker {
  ask(sessionName: string, prompt: string): Promise<string>;
}

export const TEXT_ONLY_REPLY = "I read text only for now.";
export const FAILURE_REPLY = "Something went wrong on my side. Try again.";
export const EMPTY_REPLY = "(the agent finished without saying anything)";

export interface GatewayDeps {
  api: TelegramApi;
  allowlist: Allowlist;
  pool: Asker;
  log: Log;
}

/** One update in, at most one conversation turn and its replies out. */
export class Gateway {
  constructor(private readonly deps: GatewayDeps) {}

  async handle(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (message === undefined) return;

    const chatId = message.chat.id;
    const senderId = message.from?.id;

    // First and only gate. Unknown senders get silence — not an error, which
    // would confirm the bot exists — and exactly one log line.
    if (!this.deps.allowlist.allows(senderId)) {
      this.deps.log(`ignored message from user ${senderId ?? "unknown"} in chat ${chatId}: not allowlisted`);
      return;
    }

    const threadId = message.message_thread_id;
    const text = message.text?.trim() ?? "";
    if (text === "") {
      await this.reply(chatId, threadId, TEXT_ONLY_REPLY);
      return;
    }

    const session = sessionName(chatId, threadId);
    this.deps.log(`session ${session}: prompt from user ${senderId} (${text.length} chars)`);

    let answer: string;
    try {
      answer = await this.deps.pool.ask(session, text);
    } catch (error) {
      this.deps.log(`session ${session}: turn failed: ${describe(error)}`);
      answer = FAILURE_REPLY;
    }

    await this.reply(chatId, threadId, answer === "" ? EMPTY_REPLY : answer);
  }

  private async reply(chatId: number, threadId: number | undefined, text: string): Promise<void> {
    try {
      for (const part of splitMessage(text)) {
        await this.deps.api.sendMessage(chatId, threadId, part);
      }
    } catch (error) {
      // A failed send must not take the gateway down with it.
      this.deps.log(`chat ${chatId}: sendMessage failed: ${describe(error)}`);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
