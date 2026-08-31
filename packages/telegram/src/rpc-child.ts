import { TurnCollector } from "./rpc-protocol.js";

/**
 * The child process as this package needs it: lines in, lines out, a way to
 * hear about death, a way to cause it. `spawn-rpc.ts` implements it over
 * node:child_process; tests implement it in ten lines.
 */
export interface RpcProcess {
  write(line: string): void;
  onLine(handler: (line: string) => void): void;
  onExit(handler: (reason: string) => void): void;
  kill(): void;
}

export type SpawnRpc = (sessionName: string) => RpcProcess;

interface Pending {
  prompt: string;
  resolve: (reply: string) => void;
  reject: (error: Error) => void;
}

/**
 * One live `amalgam rpc --session <name>` process, with at most one prompt in
 * flight. Messages that arrive mid-turn wait their turn: the agent has one
 * conversation per chat, and interleaving prompts into it would make the
 * transcript a lie.
 */
export class RpcChild {
  private readonly queue: Pending[] = [];
  private current: (Pending & { collector: TurnCollector }) | null = null;
  private readonly exitHandlers: Array<(reason: string) => void> = [];
  private nextPromptId = 1;
  private dead = false;

  constructor(private readonly proc: RpcProcess) {
    proc.onLine((line) => this.onLine(line));
    proc.onExit((reason) => this.handleExit(reason));
  }

  get alive(): boolean {
    return !this.dead;
  }

  /** Register a listener for the child's death, whatever the cause. */
  onExit(handler: (reason: string) => void): void {
    this.exitHandlers.push(handler);
  }

  /** Resolves with the agent's reply, or rejects if the child dies first. */
  ask(prompt: string): Promise<string> {
    if (this.dead) return Promise.reject(new Error("rpc child is not running"));
    return new Promise<string>((resolve, reject) => {
      this.queue.push({ prompt, resolve, reject });
      this.pump();
    });
  }

  kill(): void {
    this.proc.kill();
  }

  private pump(): void {
    if (this.current !== null || this.dead) return;
    const next = this.queue.shift();
    if (next === undefined) return;

    const id = `prompt-${this.nextPromptId++}`;
    this.current = { ...next, collector: new TurnCollector(id) };
    this.proc.write(`${JSON.stringify({ id, type: "prompt", message: next.prompt })}\n`);
  }

  private onLine(line: string): void {
    const current = this.current;
    if (current === null) return; // Events from a turn nobody is waiting for.

    if (!current.collector.accept(line)) return;

    this.current = null;
    const failure = current.collector.error();
    if (failure === null) current.resolve(current.collector.text());
    else current.reject(new Error(failure));
    this.pump();
  }

  private handleExit(reason: string): void {
    if (this.dead) return;
    this.dead = true;

    const abandoned = this.current === null ? [] : [this.current];
    this.current = null;
    for (const pending of [...abandoned, ...this.queue.splice(0)]) {
      pending.reject(new Error(reason));
    }
    for (const handler of this.exitHandlers) handler(reason);
  }
}
