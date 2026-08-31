import { describe, expect, it } from "vitest";
import { runPollLoop } from "../src/poll-loop.js";
import type { TelegramApi, TelegramUpdate } from "../src/telegram-api.js";

function message(updateId: number): TelegramUpdate {
  return {
    update_id: updateId,
    message: { message_id: updateId, chat: { id: 1 }, from: { id: 111 }, text: `m${updateId}` },
  };
}

/** Serves scripted rounds of getUpdates; an Error in the script is thrown. */
class ScriptedApi implements TelegramApi {
  readonly offsets: number[] = [];
  private round = 0;

  constructor(private readonly script: Array<TelegramUpdate[] | Error>) {}

  async getUpdates(offset: number): Promise<TelegramUpdate[]> {
    this.offsets.push(offset);
    const step = this.script[this.round++];
    if (step === undefined) return [];
    if (step instanceof Error) throw step;
    return step;
  }

  async sendMessage(): Promise<void> {}

  get rounds(): number {
    return this.round;
  }
}

describe("runPollLoop", () => {
  it("advances the offset past the highest update seen", async () => {
    const api = new ScriptedApi([[message(10), message(11)], [message(12)]]);
    const seen: number[] = [];

    await runPollLoop({
      api,
      log: () => {},
      pollSeconds: 50,
      onUpdate: (update) => seen.push(update.update_id),
      keepRunning: () => api.rounds < 3,
    });

    expect(seen).toEqual([10, 11, 12]);
    expect(api.offsets).toEqual([0, 12, 13]);
  });

  it("survives a network failure, backing off and retrying", async () => {
    const api = new ScriptedApi([new Error("fetch failed"), new Error("fetch failed"), [message(5)]]);
    const slept: number[] = [];
    const logs: string[] = [];

    await runPollLoop({
      api,
      log: (line) => logs.push(line),
      pollSeconds: 50,
      onUpdate: () => {},
      keepRunning: () => api.rounds < 3,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    expect(slept).toEqual([1000, 2000]);
    expect(logs.every((line) => line.includes("getUpdates failed"))).toBe(true);
    // The failed rounds must not advance the offset.
    expect(api.offsets).toEqual([0, 0, 0]);
  });

  it("does not let one bad update stop the loop or block redelivery of the rest", async () => {
    const api = new ScriptedApi([[message(1), message(2)]]);
    const seen: number[] = [];
    const logs: string[] = [];

    await runPollLoop({
      api,
      log: (line) => logs.push(line),
      pollSeconds: 50,
      onUpdate: (update) => {
        if (update.update_id === 1) throw new Error("handler exploded");
        seen.push(update.update_id);
      },
      keepRunning: () => api.rounds < 1,
    });

    expect(seen).toEqual([2]);
    expect(logs[0]).toMatch(/handler exploded/);
  });
});
