/**
 * After the agent writes to memory/ or skills/, commit it. The user reviews
 * what the agent has learned with `git log`, so every change needs to be a
 * commit; asking the model to remember to run git is asking it to forget.
 *
 * This is an extension hook rather than a fifth tool (NOT.md), and it never
 * fails a turn: a broken git setup produces a warning, not an error the model
 * has to reason about.
 */
import { execFile } from "node:child_process";
import { join, relative } from "node:path";
import { promisify } from "node:util";

import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";

import { absoluteFrom, isInside } from "./home.js";

const run = promisify(execFile);

/** Only memory/ and skills/ are committed. sessions/ is gitignored churn. */
export function isCommittablePath(home: string, cwd: string, path: string): boolean {
  const absolute = absoluteFrom(cwd, path);
  return isInside(join(home, "memory"), absolute) || isInside(join(home, "skills"), absolute);
}

export function commitMessage(home: string, absolutePath: string): string {
  return `memory: ${relative(home, absolutePath)}`;
}

/**
 * Stage the one file and commit it if that produced a change. Argument arrays
 * only — no shell, so a path is never interpreted.
 */
export async function commitFile(home: string, absolutePath: string): Promise<"committed" | "unchanged"> {
  const git = (args: string[]) => run("git", ["-C", home, ...args]);
  await git(["add", "--", absolutePath]);
  const staged = await git(["diff", "--cached", "--quiet", "--", absolutePath]).then(
    () => false,
    () => true, // `--quiet` exits non-zero exactly when there is something staged
  );
  if (!staged) {
    return "unchanged";
  }
  await git(["commit", "--quiet", "-m", commitMessage(home, absolutePath), "--", absolutePath]);
  return "committed";
}

/**
 * write and edit both take a `path`. tool_execution_end does not carry the
 * arguments, so they are remembered from tool_execution_start by call id.
 */
export function memoryCommitExtension(home: string, cwd: string): InlineExtension {
  return {
    name: "memory-commit",
    factory: (pi: ExtensionAPI) => {
      const pathByToolCall = new Map<string, string>();

      pi.on("tool_execution_start", (event) => {
        if (event.toolName !== "write" && event.toolName !== "edit") {
          return;
        }
        const path = (event.args as { path?: unknown } | undefined)?.path;
        if (typeof path === "string") {
          pathByToolCall.set(event.toolCallId, path);
        }
      });

      pi.on("tool_execution_end", async (event) => {
        const path = pathByToolCall.get(event.toolCallId);
        pathByToolCall.delete(event.toolCallId);
        if (path === undefined || event.isError || !isCommittablePath(home, cwd, path)) {
          return;
        }
        try {
          await commitFile(home, absoluteFrom(cwd, path));
        } catch (error) {
          const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
          console.warn(`amalgam: could not commit ${path}: ${detail}`);
        }
      });
    },
  };
}
