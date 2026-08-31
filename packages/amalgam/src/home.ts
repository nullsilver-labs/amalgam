/**
 * Where everything lives. One environment variable (AMALGAM_HOME), one
 * directory, and a fixed set of names inside it. Nothing here reads or writes;
 * it only computes paths, so it is safe to call from anywhere.
 */
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_HOME_DIR_NAME = ".amalgam";

/** The identity directory: ~/.amalgam unless AMALGAM_HOME says otherwise. */
export function amalgamHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.AMALGAM_HOME?.trim();
  if (!configured) {
    return join(homedir(), DEFAULT_HOME_DIR_NAME);
  }
  if (configured === "~" || configured.startsWith(`~${sep}`) || configured.startsWith("~/")) {
    return resolve(join(homedir(), configured.slice(1)));
  }
  return resolve(configured);
}

export interface HomePaths {
  home: string;
  soul: string;
  memory: string;
  memoryIndex: string;
  skills: string;
  sessions: string;
  gitignore: string;
  auth: string;
  models: string;
  modelsStore: string;
  preCommitHook: string;
}

export function homePaths(home: string): HomePaths {
  return {
    home,
    soul: join(home, "SOUL.md"),
    memory: join(home, "memory"),
    memoryIndex: join(home, "memory", "INDEX.md"),
    skills: join(home, "skills"),
    sessions: join(home, "sessions"),
    gitignore: join(home, ".gitignore"),
    auth: join(home, "auth.json"),
    models: join(home, "models.json"),
    modelsStore: join(home, "models-store.json"),
    preCommitHook: join(home, ".git", "hooks", "pre-commit"),
  };
}

/**
 * A session name is a file name, so it must not be able to escape sessions/.
 * Throwing here is better than silently writing somewhere surprising.
 */
export function sessionFile(home: string, name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes("..")) {
    throw new Error(`Invalid session name: ${name} (letters, digits, dot, dash, underscore)`);
  }
  return join(homePaths(home).sessions, `${name}.jsonl`);
}

/** True when `child` is `parent` or lives underneath it. */
export function isInside(parent: string, child: string): boolean {
  const root = resolve(parent);
  const target = resolve(child);
  return target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/**
 * The installed package root, so prompts/ and defaults/ can be found from
 * either dist/ (built) or src/ (tests). Both are one level below the root.
 */
export function packageRoot(): string {
  return resolve(fileURLToPath(new URL("..", import.meta.url)));
}

export function absoluteFrom(cwd: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}
