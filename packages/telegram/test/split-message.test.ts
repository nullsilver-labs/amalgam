import { describe, expect, it } from "vitest";
import { TELEGRAM_MESSAGE_LIMIT, splitMessage } from "../src/split-message.js";

describe("splitMessage", () => {
  it("leaves a short reply untouched", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
    expect(splitMessage("a".repeat(TELEGRAM_MESSAGE_LIMIT))).toHaveLength(1);
  });

  it("drops an empty reply rather than sending nothing", () => {
    expect(splitMessage("")).toEqual([]);
    expect(splitMessage("   \n ")).toEqual([]);
  });

  it("splits on a line boundary when there is one", () => {
    const paragraph = `${"a".repeat(50)}\n${"b".repeat(60)}\n${"c".repeat(30)}`;
    expect(splitMessage(paragraph, 100)).toEqual(["a".repeat(50), `${"b".repeat(60)}\n${"c".repeat(30)}`]);
  });

  it("hard-splits a single pathologically long line", () => {
    const parts = splitMessage("x".repeat(250), 100);
    expect(parts).toEqual(["x".repeat(100), "x".repeat(100), "x".repeat(50)]);
  });

  it("never emits a message over the limit, whatever the input", () => {
    const messy = `${"\n".repeat(5)}${"y".repeat(9000)}\n${"z".repeat(200)}`;
    const parts = splitMessage(messy, TELEGRAM_MESSAGE_LIMIT);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(parts.join("").replace(/\n/g, "")).toBe(messy.replace(/\n/g, ""));
  });

  it("keeps surrogate pairs whole across a hard split", () => {
    const parts = splitMessage(`${"a".repeat(9)}😀${"b".repeat(20)}`, 10);
    expect(parts[0]).toBe("a".repeat(9));
    expect(parts[1]?.startsWith("😀")).toBe(true);
  });

  it("preserves order and every character of a long reply", () => {
    const lines = Array.from({ length: 400 }, (_, index) => `line ${index} ${"." .repeat(20)}`);
    const parts = splitMessage(lines.join("\n"), 500);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join("\n")).toBe(lines.join("\n"));
  });
});
