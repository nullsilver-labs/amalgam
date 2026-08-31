import { describe, expect, it } from "vitest";
import { RpcChild, type RpcProcess } from "../src/rpc-child.js";
import { RpcPool } from "../src/rpc-pool.js";

/** A child process made of two arrays. No spawning, no waiting. */
class FakeProcess implements RpcProcess {
  readonly written: string[] = [];
  killed = false;
  private lineHandlers: Array<(line: string) => void> = [];
  private exitHandlers: Array<(reason: string) => void> = [];

  write(line: string): void {
    this.written.push(line);
  }

  onLine(handler: (line: string) => void): void {
    this.lineHandlers.push(handler);
  }

  onExit(handler: (reason: string) => void): void {
    this.exitHandlers.push(handler);
  }

  kill(): void {
    this.killed = true;
    this.die("killed");
  }

  /** Emit the events of a complete turn that answers with `text`. */
  answer(text: string): void {
    this.emit({ type: "agent_start" });
    this.emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } });
    this.emit({ type: "agent_settled" });
  }

  emit(event: unknown): void {
    for (const handler of this.lineHandlers) handler(JSON.stringify(event));
  }

  die(reason: string): void {
    for (const handler of this.exitHandlers) handler(reason);
  }

  /** The prompt commands sent so far, parsed. */
  prompts(): Array<Record<string, unknown>> {
    return this.written.map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}

describe("RpcChild", () => {
  it("sends a prompt command and resolves with the assistant text", async () => {
    const proc = new FakeProcess();
    const child = new RpcChild(proc);

    const reply = child.ask("hello");
    expect(proc.prompts()[0]).toMatchObject({ type: "prompt", message: "hello" });
    expect(proc.written[0]?.endsWith("\n")).toBe(true);

    proc.answer("hi there");
    expect(await reply).toBe("hi there");
  });

  it("keeps one prompt in flight and queues the rest", async () => {
    const proc = new FakeProcess();
    const child = new RpcChild(proc);

    const first = child.ask("one");
    const second = child.ask("two");
    expect(proc.written).toHaveLength(1); // "two" is waiting its turn

    proc.answer("first answer");
    expect(await first).toBe("first answer");

    expect(proc.prompts()[1]).toMatchObject({ message: "two" });
    proc.answer("second answer");
    expect(await second).toBe("second answer");
  });

  it("gives each prompt a distinct id", async () => {
    const proc = new FakeProcess();
    const child = new RpcChild(proc);
    const first = child.ask("one");
    proc.answer("a");
    await first;
    const second = child.ask("two");
    proc.answer("b");
    await second;

    const ids = proc.prompts().map((command) => command["id"]);
    expect(new Set(ids).size).toBe(2);
  });

  it("rejects the in-flight and queued prompts when the child dies", async () => {
    const proc = new FakeProcess();
    const child = new RpcChild(proc);
    const inFlight = child.ask("one");
    const queued = child.ask("two");

    proc.die("rpc child exited (code 1, signal null)");

    await expect(inFlight).rejects.toThrow(/code 1/);
    await expect(queued).rejects.toThrow(/code 1/);
    expect(child.alive).toBe(false);
    await expect(child.ask("three")).rejects.toThrow(/not running/);
  });

  it("surfaces a rejected prompt as an error", async () => {
    const proc = new FakeProcess();
    const child = new RpcChild(proc);
    const reply = child.ask("hello");
    const id = proc.prompts()[0]?.["id"];
    proc.emit({ id, type: "response", command: "prompt", success: false, error: "agent is streaming" });
    await expect(reply).rejects.toThrow(/agent is streaming/);
  });
});

describe("RpcPool", () => {
  const silent = (): void => {};

  it("reuses one child per session and spawns one per session", async () => {
    const spawned: Array<{ session: string; proc: FakeProcess }> = [];
    const pool = new RpcPool(
      (session) => {
        const proc = new FakeProcess();
        spawned.push({ session, proc });
        return proc;
      },
      60_000,
      silent,
    );

    const first = pool.ask("telegram-1", "a");
    spawned[0]?.proc.answer("A");
    expect(await first).toBe("A");

    const second = pool.ask("telegram-1", "b");
    spawned[0]?.proc.answer("B");
    expect(await second).toBe("B");
    expect(spawned).toHaveLength(1);

    const other = pool.ask("telegram-2", "c");
    spawned[1]?.proc.answer("C");
    expect(await other).toBe("C");
    expect(spawned.map((entry) => entry.session)).toEqual(["telegram-1", "telegram-2"]);
  });

  it("respawns after the child dies", async () => {
    const procs: FakeProcess[] = [];
    const pool = new RpcPool(
      () => {
        const proc = new FakeProcess();
        procs.push(proc);
        return proc;
      },
      60_000,
      silent,
    );

    const doomed = pool.ask("telegram-1", "a");
    procs[0]?.die("crashed");
    await expect(doomed).rejects.toThrow(/crashed/);
    expect(pool.activeSessions).toBe(0);

    const retry = pool.ask("telegram-1", "b");
    procs[1]?.answer("back");
    expect(await retry).toBe("back");
    expect(procs).toHaveLength(2);
  });

  it("kills a child that has been idle too long", async () => {
    const procs: FakeProcess[] = [];
    const pool = new RpcPool(
      () => {
        const proc = new FakeProcess();
        procs.push(proc);
        return proc;
      },
      5,
      silent,
    );

    const reply = pool.ask("telegram-1", "a");
    procs[0]?.answer("A");
    await reply;

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(procs[0]?.killed).toBe(true);
    expect(pool.activeSessions).toBe(0);
  });

  it("shutdown kills every child", async () => {
    const procs: FakeProcess[] = [];
    const pool = new RpcPool(
      () => {
        const proc = new FakeProcess();
        procs.push(proc);
        return proc;
      },
      60_000,
      silent,
    );

    const first = pool.ask("telegram-1", "a");
    procs[0]?.answer("A");
    await first;
    const second = pool.ask("telegram-2", "b");
    procs[1]?.answer("B");
    await second;

    pool.shutdown();
    expect(procs.every((proc) => proc.killed)).toBe(true);
    expect(pool.activeSessions).toBe(0);
  });
});
