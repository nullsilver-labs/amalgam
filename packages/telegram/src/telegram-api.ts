/** Only the fields of the Bot API this gateway actually reads. */
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: { id: number };
  from?: { id: number; username?: string };
  /** Present only in forum topics. */
  message_thread_id?: number;
}

export interface TelegramApi {
  getUpdates(offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]>;
  sendMessage(chatId: number, threadId: number | undefined, text: string): Promise<void>;
}

/** The real Bot API over plain fetch. No SDK; there is nothing here to abstract. */
export class HttpTelegramApi implements TelegramApi {
  constructor(
    private readonly botToken: string,
    private readonly apiBase = "https://api.telegram.org",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getUpdates(offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]> {
    const updates = await this.call<TelegramUpdate[]>(
      "getUpdates",
      { offset, timeout: timeoutSeconds, allowed_updates: ["message"] },
      // Give the server its full long-poll window plus room to answer.
      (timeoutSeconds + 15) * 1000,
    );
    return updates;
  }

  async sendMessage(chatId: number, threadId: number | undefined, text: string): Promise<void> {
    await this.call<unknown>(
      "sendMessage",
      { chat_id: chatId, message_thread_id: threadId, text },
      30_000,
    );
  }

  private async call<T>(method: string, body: unknown, timeoutMs: number): Promise<T> {
    // The URL carries the bot token: never put it in a log line or an error.
    const url = `${this.apiBase}/bot${this.botToken}/${method}`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const payload = (await response.json()) as { ok?: boolean; result?: T; description?: string };
    if (!response.ok || payload.ok !== true) {
      throw new Error(`telegram ${method} failed (${response.status}): ${payload.description ?? "no description"}`);
    }
    return payload.result as T;
  }
}
