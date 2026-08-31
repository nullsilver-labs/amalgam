#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { Gateway } from "./gateway.js";
import { stderrLog } from "./log.js";
import { runPollLoop } from "./poll-loop.js";
import { RpcPool } from "./rpc-pool.js";
import { makeSpawnRpc } from "./spawn-rpc.js";
import { HttpTelegramApi } from "./telegram-api.js";

function main(): void {
  const log = stderrLog;

  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    process.stderr.write(`amalgam-telegram: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  const api = new HttpTelegramApi(config.botToken);
  const pool = new RpcPool(makeSpawnRpc(config.rpcCommand, log), config.idleMs, log);
  const gateway = new Gateway({ api, allowlist: config.allowlist, pool, log });

  let running = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      log(`${signal} received, shutting down`);
      running = false;
      pool.shutdown();
      process.exit(0);
    });
  }

  log(
    `starting: ${config.allowlist.size} allowlisted user(s), rpc command "${config.rpcCommand}", ` +
      `idle timeout ${config.idleMs / 1000}s`,
  );

  void runPollLoop({
    api,
    log,
    pollSeconds: config.pollSeconds,
    keepRunning: () => running,
    // Not awaited: a turn takes as long as the agent takes, and the next
    // message for the same chat is queued by the pool, not by this loop.
    onUpdate: (update) => {
      void gateway.handle(update).catch((error: unknown) => {
        log(`update ${update.update_id} failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    },
  });
}

main();
