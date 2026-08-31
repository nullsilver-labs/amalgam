/**
 * The whole security model's first half: a set of Telegram user IDs, checked
 * before anything is forwarded. An empty allowlist denies everyone — never
 * "allow all". Config refuses to start with one, and this class agrees.
 */
export class Allowlist {
  private readonly ids: ReadonlySet<number>;

  constructor(ids: Iterable<number>) {
    this.ids = new Set(ids);
  }

  get size(): number {
    return this.ids.size;
  }

  allows(userId: number | undefined): boolean {
    if (userId === undefined) return false;
    return this.ids.has(userId);
  }

  /**
   * Comma-separated user IDs. A malformed entry throws rather than being
   * dropped: a typo must not silently shrink the list.
   */
  static parse(raw: string | undefined): Allowlist {
    const ids: number[] = [];
    for (const entry of (raw ?? "").split(",")) {
      const trimmed = entry.trim();
      if (trimmed === "") continue;
      if (!/^\d+$/.test(trimmed)) {
        throw new Error(`AMALGAM_ALLOWLIST: "${trimmed}" is not a Telegram user ID (digits only)`);
      }
      ids.push(Number(trimmed));
    }
    return new Allowlist(ids);
  }
}
