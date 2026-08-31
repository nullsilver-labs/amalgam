/**
 * PLAN.md §3.4: a bash call must always return.
 *
 * Pi already spawns children with stdin closed and detached from any terminal
 * (verified at 0.84.4), so a program that reads stdin or opens /dev/tty fails
 * instead of blocking. Two things are left, and both are configuration of Pi's
 * existing bash tool rather than a tool of our own:
 *
 *   1. an environment that makes interactive tools fail fast and readably;
 *   2. a default timeout, because Pi has none and nothing else kills a
 *      `tail -f` in an unattended session.
 *
 * The pieces below are separate pure functions so they can be tested without
 * spawning anything.
 */
import {
  type BashOperations,
  type BashSpawnContext,
  createBashToolDefinition,
  createLocalBashOperations,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

/**
 * Injected into every bash spawn. These override the inherited environment on
 * purpose: a user who exports GIT_TERMINAL_PROMPT=1 in the container would
 * otherwise reintroduce the exact hang this exists to prevent. Everything else
 * in the environment (PATH above all) is left alone.
 */
export const NON_INTERACTIVE_ENV: Readonly<Record<string, string>> = Object.freeze({
  GIT_TERMINAL_PROMPT: "0",
  GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=10",
  SSH_ASKPASS: "/bin/false",
  DEBIAN_FRONTEND: "noninteractive",
  PAGER: "cat",
  GIT_PAGER: "cat",
  EDITOR: "true",
  CI: "1",
});

export function applyNonInteractiveEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, ...NON_INTERACTIVE_ENV };
}

export function nonInteractiveSpawnHook(context: BashSpawnContext): BashSpawnContext {
  return { ...context, env: applyNonInteractiveEnv(context.env) };
}

export const FALLBACK_BASH_TIMEOUT_SECONDS = 300;

/** AMALGAM_BASH_TIMEOUT in seconds. Anything unparseable falls back. */
export function resolveDefaultTimeoutSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AMALGAM_BASH_TIMEOUT?.trim();
  if (!raw) {
    return FALLBACK_BASH_TIMEOUT_SECONDS;
  }
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : FALLBACK_BASH_TIMEOUT_SECONDS;
}

/**
 * Apply the default only when the model omitted a timeout. A model that asks
 * for ten minutes to run a build gets ten minutes; a model that asks for
 * nothing does not get forever.
 */
export function withDefaultTimeout(operations: BashOperations, defaultSeconds: number): BashOperations {
  return {
    exec: (command, cwd, options) =>
      operations.exec(command, cwd, { ...options, timeout: options.timeout ?? defaultSeconds }),
  };
}

export interface BashToolOptions {
  shellPath?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Pi's bash tool with both guarantees wired in. Same tool in every mode.
 * defineTool() only widens the generics so this fits `customTools`.
 */
export function createAmalgamBashTool(cwd: string, options: BashToolOptions = {}): ToolDefinition {
  const shellPath = options.shellPath;
  return defineTool(
    createBashToolDefinition(cwd, {
      shellPath,
      spawnHook: nonInteractiveSpawnHook,
      operations: withDefaultTimeout(
        createLocalBashOperations({ shellPath }),
        resolveDefaultTimeoutSeconds(options.env ?? process.env),
      ),
    }),
  );
}
