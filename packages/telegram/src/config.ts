import { Allowlist } from "./allowlist.js";

export interface Config {
  botToken: string;
  allowlist: Allowlist;
  /** The harness binary to drive; `rpc --session <name>` is appended. */
  rpcCommand: string;
  idleMs: number;
  pollSeconds: number;
}

const DEFAULT_IDLE_SECONDS = 600;
const LONG_POLL_SECONDS = 50;

/**
 * Everything the gateway can be configured with, and a readable death if it
 * cannot start. Four environment variables, documented in .env.example.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const botToken = (env["TELEGRAM_BOT_TOKEN"] ?? "").trim();
  if (botToken === "") {
    throw new Error("TELEGRAM_BOT_TOKEN is not set. Put the token from @BotFather in .env.");
  }

  const allowlist = Allowlist.parse(env["AMALGAM_ALLOWLIST"]);
  if (allowlist.size === 0) {
    // An empty allowlist is a misconfiguration, never "allow everyone": this
    // bot is a remote shell with a friendly face.
    throw new Error(
      "AMALGAM_ALLOWLIST is empty. Set it to your Telegram user ID (comma-separated for more than one). " +
        "An empty allowlist does not mean 'allow everyone'; the gateway refuses to start.",
    );
  }

  return {
    botToken,
    allowlist,
    rpcCommand: (env["AMALGAM_RPC_COMMAND"] ?? "amalgam").trim() || "amalgam",
    idleMs: readSeconds(env["AMALGAM_IDLE_TIMEOUT"], DEFAULT_IDLE_SECONDS) * 1000,
    pollSeconds: LONG_POLL_SECONDS,
  };
}

function readSeconds(raw: string | undefined, fallback: number): number {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return fallback;
  const seconds = Number(trimmed);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`AMALGAM_IDLE_TIMEOUT: "${trimmed}" is not a positive number of seconds`);
  }
  return seconds;
}
