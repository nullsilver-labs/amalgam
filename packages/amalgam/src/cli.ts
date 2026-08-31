#!/usr/bin/env node
/**
 * The `amalgam` binary. Six subcommands, parsed by hand: the argument grammar
 * is small enough to read, and a parser dependency would be the first crack in
 * "no dependency beyond the Pi SDK".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { initTheme, InteractiveMode, runPrintMode, runRpcMode } from "@earendil-works/pi-coding-agent";

import { listProviders, login } from "./auth.js";
import { doctor } from "./doctor.js";
import { amalgamHome, packageRoot, sessionFile } from "./home.js";
import { initHome } from "./init.js";
import { createAmalgamRuntime, createModelRuntime } from "./session.js";

const USAGE = `amalgam — a persistent personal agent: a directory of plain text, a loop, four tools.

  amalgam                              interactive session
  amalgam init                         create AMALGAM_HOME (idempotent)
  amalgam run --session <name> <text>  one prompt, print the answer, exit
  amalgam rpc [--session <name>]       JSONL over stdio, for a gateway
  amalgam auth [provider]              list providers, or sign in to one
  amalgam doctor                       home, bash timeout, models, mounts
  amalgam --help | --version

Environment:
  AMALGAM_HOME           identity directory (default ~/.amalgam)
  AMALGAM_BASH_TIMEOUT   seconds, applied when the model omits a timeout (default 300)
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === "--help" || command === "-h" || command === "help") {
    console.log(USAGE);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    console.log(version());
    return 0;
  }

  const home = amalgamHome();

  switch (command) {
    case undefined:
      return await interactive(home);
    case "init":
      return init(home);
    case "run":
      return await run(home, rest);
    case "rpc":
      return await rpc(home, rest);
    case "auth":
      return await auth(home, rest);
    case "doctor":
      return await runDoctor(home);
    default:
      console.error(`Unknown command: ${command}\n\n${USAGE}`);
      return 2;
  }
}

async function interactive(home: string): Promise<number> {
  initTheme(undefined, true);
  const runtime = await createAmalgamRuntime({ home, cwd: process.cwd() });
  const mode = new InteractiveMode(runtime, {
    startupDiagnostics: [...runtime.diagnostics],
    modelFallbackMessage: runtime.modelFallbackMessage,
  });
  await mode.run();
  return 0;
}

function init(home: string): number {
  const report = initHome(home);
  console.log(`amalgam home: ${report.home}`);
  for (const path of report.created) {
    console.log(`  created  ${path}`);
  }
  for (const path of report.kept) {
    console.log(`  kept     ${path}`);
  }
  for (const warning of report.warnings) {
    console.warn(`  warning  ${warning}`);
  }
  return report.warnings.length === 0 ? 0 : 1;
}

/** The cron and sub-agent entry point: resume the named session, answer, exit. */
async function run(home: string, args: string[]): Promise<number> {
  const { session, positional } = takeSession(args);
  if (session === undefined) {
    console.error("amalgam run requires --session <name>");
    return 2;
  }
  const prompt = positional.join(" ").trim();
  if (!prompt) {
    console.error('amalgam run requires a prompt: amalgam run --session <name> "<prompt>"');
    return 2;
  }
  initTheme(undefined, false);
  const runtime = await createAmalgamRuntime({
    home,
    cwd: process.cwd(),
    sessionFile: sessionFile(home, session),
  });
  return await runPrintMode(runtime, { mode: "text", initialMessage: prompt });
}

async function rpc(home: string, args: string[]): Promise<number> {
  const { session } = takeSession(args);
  initTheme(undefined, false);
  const runtime = await createAmalgamRuntime({
    home,
    cwd: process.cwd(),
    sessionFile: session === undefined ? undefined : sessionFile(home, session),
  });
  await runRpcMode(runtime); // never returns; it owns stdin until the pipe closes
  return 0;
}

async function auth(home: string, args: string[]): Promise<number> {
  const modelRuntime = await createModelRuntime(home);
  const provider = args[0];
  if (provider === undefined) {
    listProviders(modelRuntime);
  } else {
    await login(modelRuntime, provider);
  }
  return 0;
}

async function runDoctor(home: string): Promise<number> {
  await doctor(home, await createModelRuntime(home));
  return 0;
}

function takeSession(args: string[]): { session?: string; positional: string[] } {
  const positional: string[] = [];
  let session: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--session" || arg === "-s") {
      session = args[++i];
      if (session === undefined) {
        throw new Error("--session needs a name");
      }
    } else if (arg.startsWith("--session=")) {
      session = arg.slice("--session=".length);
    } else {
      positional.push(arg);
    }
  }
  return { session, positional };
}

function version(): string {
  const manifest = readFileSync(join(packageRoot(), "package.json"), "utf-8");
  return (JSON.parse(manifest) as { version: string }).version;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(`amalgam: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
