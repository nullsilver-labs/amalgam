import { describe, expect, it } from "vitest";
import { HttpTelegramApi } from "../src/telegram-api.js";

interface Call {
  url: string;
  body: Record<string, unknown>;
}

/** A fetch that answers from a script. Nothing here touches the network. */
function fakeFetch(reply: unknown, status = 200) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return {
      ok: status < 400,
      status,
      json: async () => reply,
    } as Response;
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe("HttpTelegramApi", () => {
  it("long-polls getUpdates for messages only", async () => {
    const { calls, impl } = fakeFetch({ ok: true, result: [{ update_id: 1 }] });
    const api = new HttpTelegramApi("secret-token", "https://api.example", impl);

    const updates = await api.getUpdates(42, 50);

    expect(updates).toEqual([{ update_id: 1 }]);
    expect(calls[0]?.url).toBe("https://api.example/botsecret-token/getUpdates");
    expect(calls[0]?.body).toEqual({ offset: 42, timeout: 50, allowed_updates: ["message"] });
  });

  it("sends a message, into a forum topic when there is one", async () => {
    const { calls, impl } = fakeFetch({ ok: true, result: {} });
    const api = new HttpTelegramApi("t", "https://api.example", impl);

    await api.sendMessage(500, 7, "hello");
    await api.sendMessage(500, undefined, "hello");

    expect(calls[0]?.body).toEqual({ chat_id: 500, message_thread_id: 7, text: "hello" });
    expect(calls[1]?.body).toEqual({ chat_id: 500, text: "hello" });
  });

  it("throws on an API error, without leaking the token", async () => {
    const { impl } = fakeFetch({ ok: false, description: "chat not found" }, 400);
    const api = new HttpTelegramApi("secret-token", "https://api.example", impl);

    await expect(api.sendMessage(1, undefined, "hi")).rejects.toThrow(/chat not found/);
    await expect(api.sendMessage(1, undefined, "hi")).rejects.not.toThrow(/secret-token/);
  });
});
