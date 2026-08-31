/**
 * The wire format of `amalgam rpc` (Pi's RPC mode): one JSON object per line,
 * commands in on stdin, events out on stdout. Both halves here are pure —
 * strings in, strings out — so the tests need no child process.
 *
 * See docs/rpc.md in @earendil-works/pi-coding-agent.
 */

/**
 * Framing per rpc.md: LF is the only record delimiter, a trailing CR is
 * stripped. Node's readline is NOT usable here — it also splits on U+2028 and
 * U+2029, which are legal inside JSON strings.
 */
export class JsonlDecoder {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) break;
      lines.push(stripCarriageReturn(this.buffer.slice(0, newline)));
      this.buffer = this.buffer.slice(newline + 1);
    }
    return lines;
  }

  /** Whatever arrived without a final newline, at stream end. */
  flush(): string[] {
    if (this.buffer === "") return [];
    const last = stripCarriageReturn(this.buffer);
    this.buffer = "";
    return last === "" ? [] : [last];
  }
}

function stripCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/**
 * Accumulates one prompt's reply from the event stream.
 *
 * Events we depend on:
 *   - `response` for command `prompt` with `success: false` — the prompt was
 *     rejected; nothing will follow, so the turn is over.
 *   - `message_end` with an assistant message — authoritative text for that
 *     message (rpc.md says to treat it so, and it saves us reassembling
 *     `message_update` deltas by contentIndex).
 *   - `agent_settled` — the run is fully settled: no retry, no compaction
 *     retry, no queued continuation. `agent_end` is NOT the end; it can be
 *     followed by an automatic retry.
 *
 * Everything else — thinking, tool calls, tool output, queue and compaction
 * events — is deliberately ignored. Telegram gets prose.
 */
export class TurnCollector {
  private readonly parts: string[] = [];
  private failure: string | null = null;

  constructor(private readonly promptId: string) {}

  /** Feed one JSONL line. Returns true once the turn is complete. */
  accept(line: string): boolean {
    const event = parseEvent(line);
    if (event === null) return false;

    if (event["type"] === "response" && event["command"] === "prompt") {
      const sameRequest = event["id"] === undefined || event["id"] === this.promptId;
      if (sameRequest && event["success"] === false) {
        this.failure = typeof event["error"] === "string" ? event["error"] : "prompt rejected";
        return true;
      }
      return false;
    }

    if (event["type"] === "message_end") {
      const text = assistantText(event["message"]);
      if (text !== "") this.parts.push(text);
      return false;
    }

    return event["type"] === "agent_settled";
  }

  /** The assembled reply: every assistant message of the turn, in order. */
  text(): string {
    return this.parts.join("\n\n").trim();
  }

  /** Non-null if the agent refused the prompt. */
  error(): string | null {
    return this.failure;
  }
}

function parseEvent(line: string): Record<string, unknown> | null {
  if (line.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Text blocks of an assistant message; thinking and tool calls are dropped. */
function assistantText(message: unknown): string {
  if (typeof message !== "object" || message === null) return "";
  const record = message as Record<string, unknown>;
  if (record["role"] !== "assistant") return "";

  const content = record["content"];
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => {
      if (typeof block !== "object" || block === null) return "";
      const typed = block as Record<string, unknown>;
      return typed["type"] === "text" && typeof typed["text"] === "string" ? typed["text"] : "";
    })
    .join("")
    .trim();
}
