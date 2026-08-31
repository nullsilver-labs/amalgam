import { describe, expect, it } from "vitest";
import { JsonlDecoder, TurnCollector } from "../src/rpc-protocol.js";

/** A plausible stream for "what is 2 + 2?", with a tool call in the middle. */
function recordedTurn(): string[] {
  return [
    { type: "agent_start" },
    { type: "turn_start" },
    { type: "message_start", message: { role: "assistant", content: [] } },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Let me " } },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "check." } },
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "the user wants arithmetic" },
          { type: "text", text: "Let me check." },
          { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "echo 4" } },
        ],
      },
    },
    { type: "tool_execution_start", toolCallId: "call_1", toolName: "bash", args: { command: "echo 4" } },
    { type: "tool_execution_end", toolCallId: "call_1", toolName: "bash", result: { content: [{ type: "text", text: "4" }] }, isError: false },
    { type: "message_end", message: { role: "toolResult", toolCallId: "call_1", content: [{ type: "text", text: "4" }] } },
    { type: "turn_end", message: { role: "assistant" }, toolResults: [] },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "It is 4." }] } },
    { type: "agent_end", messages: [], willRetry: false },
    { type: "agent_settled" },
  ].map((event) => JSON.stringify(event));
}

describe("JsonlDecoder", () => {
  it("splits on LF only, across chunk boundaries", () => {
    const decoder = new JsonlDecoder();
    expect(decoder.push('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
    expect(decoder.push(':2}\n{"c":3}')).toEqual(['{"b":2}']);
    expect(decoder.flush()).toEqual(['{"c":3}']);
  });

  it("strips a trailing CR", () => {
    expect(new JsonlDecoder().push('{"a":1}\r\n')).toEqual(['{"a":1}']);
  });

  it("does not split on U+2028 or U+2029, which are legal inside JSON strings", () => {
    const line = JSON.stringify({ type: "x", text: "before\u2028after\u2029end" });
    expect(new JsonlDecoder().push(`${line}\n`)).toEqual([line]);
  });

  it("returns nothing at flush when the stream ended cleanly", () => {
    const decoder = new JsonlDecoder();
    decoder.push('{"a":1}\n');
    expect(decoder.flush()).toEqual([]);
  });
});

describe("TurnCollector", () => {
  it("assembles the assistant text of a turn and stops at agent_settled", () => {
    const collector = new TurnCollector("prompt-1");
    const lines = recordedTurn();

    const doneAt = lines.findIndex((line) => collector.accept(line));

    expect(doneAt).toBe(lines.length - 1);
    expect(collector.error()).toBeNull();
    expect(collector.text()).toBe("Let me check.\n\nIt is 4.");
  });

  it("does not end at agent_end, which may be followed by a retry", () => {
    const collector = new TurnCollector("prompt-1");
    expect(collector.accept(JSON.stringify({ type: "agent_end", messages: [], willRetry: true }))).toBe(false);
    expect(collector.accept(JSON.stringify({ type: "auto_retry_start", attempt: 1 }))).toBe(false);
    expect(collector.accept(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Second try." }] } }))).toBe(false);
    expect(collector.accept(JSON.stringify({ type: "agent_settled" }))).toBe(true);
    expect(collector.text()).toBe("Second try.");
  });

  it("accepts a string content assistant message", () => {
    const collector = new TurnCollector("prompt-1");
    collector.accept(JSON.stringify({ type: "message_end", message: { role: "assistant", content: "plain" } }));
    collector.accept(JSON.stringify({ type: "agent_settled" }));
    expect(collector.text()).toBe("plain");
  });

  it("ends the turn when the prompt is rejected", () => {
    const collector = new TurnCollector("prompt-1");
    const rejection = { id: "prompt-1", type: "response", command: "prompt", success: false, error: "agent is streaming" };
    expect(collector.accept(JSON.stringify(rejection))).toBe(true);
    expect(collector.error()).toBe("agent is streaming");
  });

  it("ignores an accepted-prompt response and responses to other commands", () => {
    const collector = new TurnCollector("prompt-1");
    expect(collector.accept(JSON.stringify({ id: "prompt-1", type: "response", command: "prompt", success: true }))).toBe(false);
    expect(collector.accept(JSON.stringify({ type: "response", command: "get_state", success: false, error: "nope" }))).toBe(false);
    expect(collector.error()).toBeNull();
  });

  it("survives junk on the stream", () => {
    const collector = new TurnCollector("prompt-1");
    expect(collector.accept("not json at all")).toBe(false);
    expect(collector.accept("")).toBe(false);
    expect(collector.accept("null")).toBe(false);
    expect(collector.text()).toBe("");
  });
});
