import { describe, expect, it } from "vitest";
import { sessionName } from "../src/session-name.js";

describe("sessionName", () => {
  it("uses the chat id alone when there is no thread", () => {
    expect(sessionName(4242)).toBe("telegram-4242");
    expect(sessionName(4242, undefined)).toBe("telegram-4242");
  });

  it("appends the forum topic id when there is one", () => {
    expect(sessionName(4242, 7)).toBe("telegram-4242-7");
  });

  it("keeps group chat ids, which are negative", () => {
    expect(sessionName(-1001234567890)).toBe("telegram--1001234567890");
  });

  it("is stable, so tomorrow's message resumes today's session", () => {
    expect(sessionName(1, 2)).toBe(sessionName(1, 2));
  });
});
