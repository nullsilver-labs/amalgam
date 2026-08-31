import { describe, expect, it } from "vitest";

import { systemPrompt, TOOLS } from "../src/session.js";

/** PROTOCOL.md: "System prompt under 1k tokens." ceil(chars / 3.6) is the estimate. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

describe("prompts/system.md", () => {
  it("stays under the 1k token budget", () => {
    const tokens = estimateTokens(systemPrompt());
    expect(tokens).toBeLessThan(1000);
  });

  it("keeps a margin, so an edit does not silently break the budget", () => {
    expect(estimateTokens(systemPrompt())).toBeLessThan(700);
  });

  it("says the things the harness relies on the model knowing", () => {
    const prompt = systemPrompt();
    expect(prompt).toContain("SOUL.md");
    expect(prompt).toContain("memory/INDEX.md");
    expect(prompt).toContain("skills/learn.md");
    expect(prompt).toContain("amalgam run --session");
    expect(prompt).toContain("no terminal");
  });
});

describe("tools", () => {
  it("is exactly four", () => {
    expect(TOOLS).toEqual(["read", "write", "edit", "bash"]);
  });
});
