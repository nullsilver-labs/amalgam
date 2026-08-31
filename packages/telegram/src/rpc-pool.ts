import type { Log } from "./log.js";
import { RpcChild, type SpawnRpc } from "./rpc-child.js";

interface Entry {
  child: RpcChild;
  idleTimer: NodeJS.Timeout | null;
}

/**
 * One long-lived `amalgam rpc` child per active chat, spawned on the first
 * message and killed after an idle stretch. Killing is safe: the session lives
 * in ~/.amalgam/sessions, so the next message resumes the same conversation
 * with a fresh process.
 */
export class RpcPool {
  private readonly children = new Map<string, Entry>();

  constructor(
    private readonly spawn: SpawnRpc,
    private readonly idleMs: number,
    private readonly log: Log,
  ) {}

  get activeSessions(): number {
    return this.children.size;
  }

  async ask(sessionName: string, prompt: string): Promise<string> {
    const entry = this.childFor(sessionName);
    this.clearIdleTimer(entry);
    try {
      return await entry.child.ask(prompt);
    } finally {
      // Only start the clock once the turn is over, however it ended.
      if (this.children.get(sessionName) === entry) this.startIdleTimer(sessionName, entry);
    }
  }

  /** Kill every child, e.g. on SIGTERM. */
  shutdown(): void {
    for (const [sessionName, entry] of this.children) {
      this.clearIdleTimer(entry);
      this.children.delete(sessionName);
      entry.child.kill();
    }
  }

  private childFor(sessionName: string): Entry {
    const existing = this.children.get(sessionName);
    if (existing !== undefined && existing.child.alive) return existing;

    this.log(`spawning rpc child for session ${sessionName}`);
    const entry: Entry = { child: new RpcChild(this.spawn(sessionName)), idleTimer: null };
    entry.child.onExit((reason) => {
      this.log(`rpc child for session ${sessionName} exited: ${reason}`);
      if (this.children.get(sessionName) === entry) {
        this.clearIdleTimer(entry);
        this.children.delete(sessionName);
      }
    });
    this.children.set(sessionName, entry);
    return entry;
  }

  private startIdleTimer(sessionName: string, entry: Entry): void {
    this.clearIdleTimer(entry);
    entry.idleTimer = setTimeout(() => {
      this.log(`idle timeout for session ${sessionName}, stopping rpc child`);
      this.children.delete(sessionName);
      entry.child.kill();
    }, this.idleMs);
    // The poll loop keeps the process alive; an idle timer must not.
    entry.idleTimer.unref?.();
  }

  private clearIdleTimer(entry: Entry): void {
    if (entry.idleTimer === null) return;
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
}
