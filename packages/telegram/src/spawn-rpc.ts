import { spawn } from "node:child_process";
import type { Log } from "./log.js";
import type { RpcProcess, SpawnRpc } from "./rpc-child.js";
import { JsonlDecoder } from "./rpc-protocol.js";

/**
 * Spawns `amalgam rpc --session <name>` and speaks JSONL to it over stdio.
 * The command is configurable (AMALGAM_RPC_COMMAND) so development and tests
 * can point at something that is not the real harness.
 */
export function makeSpawnRpc(command: string, log: Log): SpawnRpc {
  return (sessionName: string): RpcProcess => {
    const child = spawn(command, ["rpc", "--session", sessionName], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const decoder = new JsonlDecoder();
    const lineHandlers: Array<(line: string) => void> = [];
    const exitHandlers: Array<(reason: string) => void> = [];
    let exited = false;

    const emitLines = (lines: string[]): void => {
      for (const line of lines) {
        for (const handler of lineHandlers) handler(line);
      }
    };

    const exit = (reason: string): void => {
      if (exited) return;
      exited = true;
      emitLines(decoder.flush());
      for (const handler of exitHandlers) handler(reason);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => emitLines(decoder.push(chunk)));

    // The agent's own diagnostics; useful when a chat goes quiet.
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (line.trim() !== "") log(`[${sessionName}] ${line}`);
      }
    });

    child.on("error", (error: Error) => exit(`failed to run ${command}: ${error.message}`));
    child.on("exit", (code, signal) => exit(`rpc child exited (code ${code}, signal ${signal})`));
    // A closed stdin pipe would otherwise crash the gateway on write.
    child.stdin.on("error", (error: Error) => exit(`rpc child stdin closed: ${error.message}`));

    return {
      write: (line) => child.stdin.write(line),
      onLine: (handler) => lineHandlers.push(handler),
      onExit: (handler) => exitHandlers.push(handler),
      kill: () => child.kill("SIGTERM"),
    };
  };
}
