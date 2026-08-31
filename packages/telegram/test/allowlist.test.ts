import { describe, expect, it } from "vitest";
import { Allowlist } from "../src/allowlist.js";

describe("Allowlist.parse", () => {
  it("reads comma-separated ids and ignores whitespace", () => {
    const allowlist = Allowlist.parse(" 111 , 222,333 ");
    expect(allowlist.size).toBe(3);
    expect(allowlist.allows(222)).toBe(true);
    expect(allowlist.allows(444)).toBe(false);
  });

  it("treats trailing and repeated commas as empty entries", () => {
    expect(Allowlist.parse("111,,222,").size).toBe(2);
  });

  it("rejects anything that is not a user id", () => {
    expect(() => Allowlist.parse("111,@marco")).toThrow(/not a Telegram user ID/);
    expect(() => Allowlist.parse("-100123")).toThrow(/not a Telegram user ID/);
  });
});

describe("an empty allowlist", () => {
  it("denies everyone, including unknown senders", () => {
    for (const raw of [undefined, "", "  ", ",,"]) {
      const allowlist = Allowlist.parse(raw);
      expect(allowlist.size).toBe(0);
      expect(allowlist.allows(111)).toBe(false);
      expect(allowlist.allows(undefined)).toBe(false);
    }
  });
});

describe("a populated allowlist", () => {
  it("denies a message with no sender", () => {
    expect(new Allowlist([111]).allows(undefined)).toBe(false);
  });
});
