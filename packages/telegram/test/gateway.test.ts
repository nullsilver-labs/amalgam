import { describe, expect, it } from "vitest";
import { Allowlist } from "../src/allowlist.js";
import { FAILURE_REPLY, Gateway, TEXT_ONLY_REPLY } from "../src/gateway.js";
import { TELEGRAM_MESSAGE_LIMIT } from "../src/split-message.js";
import type { TelegramApi, TelegramUpdate } from "../src/telegram-api.js";

interface Sent {
  chatId: number;
  threadId: number | undefined;
  text: string;
}

class FakeApi implements TelegramApi {
  readonly sent: Sent[] = [];

  async getUpdates(): Promise<TelegramUpdate[]> {
    return [];
  }

  async sendMessage(chatId: number, threadId: number | undefined, text: string): Promise<void> {
    this.sent.push({ chatId, threadId, text });
  }
}

function build(options: { reply?: string; fail?: boolean } = {}) {
  const api = new FakeApi();
  const asked: Array<{ session: string; prompt: string }> = [];
  const logs: string[] = [];
  const gateway = new Gateway({
    api,
    allowlist: Allowlist.parse("111"),
    log: (message) => logs.push(message),
    pool: {
      ask: async (session, prompt) => {
        asked.push({ session, prompt });
        if (options.fail === true) throw new Error("child died");
        return options.reply ?? "pong";
      },
    },
  });
  return { api, asked, logs, gateway };
}

function update(over: Partial<{ userId: number; chatId: number; threadId: number; text: string }> = {}): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      chat: { id: over.chatId ?? 500 },
      from: { id: over.userId ?? 111 },
      message_thread_id: over.threadId,
      text: over.text ?? "ping",
    },
  };
}

describe("Gateway", () => {
  it("forwards an allowlisted message and replies with the agent's text", async () => {
    const { api, asked, gateway } = build({ reply: "pong" });
    await gateway.handle(update());

    expect(asked).toEqual([{ session: "telegram-500", prompt: "ping" }]);
    expect(api.sent).toEqual([{ chatId: 500, threadId: undefined, text: "pong" }]);
  });

  it("routes a forum topic to its own session and replies in the topic", async () => {
    const { api, asked, gateway } = build();
    await gateway.handle(update({ threadId: 7 }));

    expect(asked[0]?.session).toBe("telegram-500-7");
    expect(api.sent[0]?.threadId).toBe(7);
  });

  it("gives an unknown sender nothing at all, and logs one line", async () => {
    const { api, asked, logs, gateway } = build();
    await gateway.handle(update({ userId: 999 }));

    expect(asked).toEqual([]);
    expect(api.sent).toEqual([]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/999.*not allowlisted/);
  });

  it("ignores an update with no message", async () => {
    const { api, asked, gateway } = build();
    await gateway.handle({ update_id: 2 });
    expect(asked).toEqual([]);
    expect(api.sent).toEqual([]);
  });

  it("says so when the message is not text", async () => {
    const { api, asked, gateway } = build();
    await gateway.handle(update({ text: "" }));
    expect(asked).toEqual([]);
    expect(api.sent[0]?.text).toBe(TEXT_ONLY_REPLY);
  });

  it("apologizes and logs when the child dies mid-turn", async () => {
    const { api, logs, gateway } = build({ fail: true });
    await gateway.handle(update());

    expect(api.sent[0]?.text).toBe(FAILURE_REPLY);
    expect(logs.some((line) => line.includes("child died"))).toBe(true);
  });

  it("splits a long reply and sends the parts in order", async () => {
    const long = `${"a".repeat(TELEGRAM_MESSAGE_LIMIT)}\n${"b".repeat(10)}`;
    const { api, gateway } = build({ reply: long });
    await gateway.handle(update());

    expect(api.sent.map((message) => message.text)).toEqual(["a".repeat(TELEGRAM_MESSAGE_LIMIT), "b".repeat(10)]);
  });

  it("stays up when sendMessage fails", async () => {
    const { logs, gateway } = build();
    const api = new FakeApi();
    api.sendMessage = async () => {
      throw new Error("429 too many requests");
    };
    const failing = new Gateway({
      api,
      allowlist: Allowlist.parse("111"),
      log: (message) => logs.push(message),
      pool: { ask: async () => "pong" },
    });

    await expect(failing.handle(update())).resolves.toBeUndefined();
    expect(logs.some((line) => line.includes("429"))).toBe(true);
  });
});
