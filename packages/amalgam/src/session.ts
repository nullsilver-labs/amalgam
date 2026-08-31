/**
 * One function builds the agent, and all three modes (interactive, run, rpc)
 * use it. If a mode behaves differently from another, the difference is in the
 * mode, never in the agent.
 *
 * Prompt assembly, in order:
 *   prompts/system.md  →  SOUL.md and memory/INDEX.md as context files
 *                      →  skills discovered in ~/.amalgam/skills
 * All three end up in the system prompt, and all three are files you can read.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

import { createAmalgamBashTool } from "./bash-liveness.js";
import { homePaths, packageRoot } from "./home.js";
import { memoryCommitExtension } from "./memory-commit.js";

/** PROTOCOL.md principle 2. Our bash replaces Pi's; see bash-liveness.ts. */
export const TOOLS = ["read", "write", "edit", "bash"];

export function systemPrompt(): string {
  return readFileSync(join(packageRoot(), "prompts", "system.md"), "utf-8").trim();
}

/** SOUL.md and memory/INDEX.md, injected verbatim with their real paths. */
export function identityFiles(home: string): Array<{ path: string; content: string }> {
  const paths = homePaths(home);
  return [paths.soul, paths.memoryIndex]
    .filter((path) => existsSync(path))
    .map((path) => ({ path, content: readFileSync(path, "utf-8").trim() }));
}

export function createModelRuntime(home: string): Promise<ModelRuntime> {
  const paths = homePaths(home);
  return ModelRuntime.create({
    authPath: paths.auth,
    modelsPath: paths.models,
    modelsStorePath: paths.modelsStore,
  });
}

export interface RuntimeOptions {
  home: string;
  cwd: string;
  /** Absolute path under sessions/. Omitted means a fresh session file. */
  sessionFile?: string;
  modelRuntime?: ModelRuntime;
}

export async function createAmalgamRuntime(options: RuntimeOptions): Promise<AgentSessionRuntime> {
  const { home, cwd } = options;
  const paths = homePaths(home);
  const modelRuntime = options.modelRuntime ?? (await createModelRuntime(home));
  const prompt = systemPrompt();

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd: sessionCwd, sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({
      cwd: sessionCwd,
      agentDir: home,
      modelRuntime,
      resourceLoaderOptions: {
        systemPromptOverride: () => prompt,
        agentsFilesOverride: (base) => ({ agentsFiles: [...identityFiles(home), ...base.agentsFiles] }),
        extensionFactories: [memoryCommitExtension(home, sessionCwd)],
      },
    });
    const created = await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
      tools: TOOLS,
      customTools: [createAmalgamBashTool(sessionCwd)],
    });
    return { ...created, services, diagnostics: services.diagnostics };
  };

  return createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir: home,
    sessionManager: openSession(paths.sessions, cwd, options.sessionFile),
  });
}

/**
 * A named session resumes if the file exists and is created if it does not —
 * SessionManager.open() already behaves that way. cwd is passed explicitly so
 * a session started elsewhere yesterday still runs here today.
 */
function openSession(sessionsDir: string, cwd: string, sessionFile?: string): SessionManager {
  return sessionFile === undefined
    ? SessionManager.create(cwd, sessionsDir)
    : SessionManager.open(sessionFile, sessionsDir, cwd);
}
