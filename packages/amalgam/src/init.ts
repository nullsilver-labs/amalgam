/**
 * `amalgam init`: bring an identity directory into existence.
 *
 * Every step is idempotent and none of them overwrite a file the user might
 * have edited. Running init twice is expected — after a Pi bump, after a fresh
 * container, after someone deletes a file to get the default back.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { homePaths, packageRoot } from "./home.js";
import { HOOK_MARKER, preCommitHook } from "./secret-scan.js";

/** Secrets and machine state. Everything else in ~/.amalgam is reviewable text. */
const GITIGNORE = `sessions/
auth.json
models.json
models-store.json
`;

export interface InitReport {
  home: string;
  created: string[];
  kept: string[];
  warnings: string[];
}

export function initHome(home: string): InitReport {
  const paths = homePaths(home);
  const report: InitReport = { home, created: [], kept: [], warnings: [] };
  const note = (path: string, wasCreated: boolean) => {
    (wasCreated ? report.created : report.kept).push(relative(home, path) || ".");
  };

  mkdirSync(paths.sessions, { recursive: true });

  copyDefaults(join(packageRoot(), "defaults"), home, note);
  note(paths.gitignore, writeIfAbsent(paths.gitignore, GITIGNORE));

  const isRepo = existsSync(join(home, ".git"));
  if (!isRepo) {
    git(home, ["init", "--quiet"], report);
    report.created.push(".git");
  }
  ensureCommitIdentity(home, report);
  note(paths.preCommitHook, installHook(paths.preCommitHook));

  if (!hasCommits(home)) {
    git(home, ["add", "--all"], report);
    git(home, ["commit", "--quiet", "-m", "amalgam: initial identity"], report);
  }
  return report;
}

/** Copy defaults/ file by file, so a user's edited SOUL.md survives. */
function copyDefaults(from: string, to: string, note: (path: string, created: boolean) => void): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const destination = join(to, entry.name);
    if (entry.isDirectory()) {
      copyDefaults(source, destination, note);
    } else {
      note(destination, writeIfAbsent(destination, readFileSync(source, "utf-8")));
    }
  }
}

function writeIfAbsent(path: string, content: string): boolean {
  if (existsSync(path)) {
    return false;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
  return true;
}

/** Update our own hook (so a new pattern reaches an old home), never someone else's. */
function installHook(path: string): boolean {
  const wanted = preCommitHook();
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : undefined;
  if (existing === wanted || (existing !== undefined && !existing.includes(HOOK_MARKER))) {
    return false;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, wanted, "utf-8");
  chmodSync(path, 0o755);
  return true;
}

/**
 * Memory commits must work in a container with no ~/.gitconfig. compose.yml
 * sets the GIT_AUTHOR and GIT_COMMITTER variables; when it has not, write a
 * local identity once so the agent's commits do not fail at 3am.
 */
function ensureCommitIdentity(home: string, report: InitReport): void {
  if (readGit(home, ["config", "user.email"]) !== undefined) {
    return;
  }
  if (process.env.GIT_AUTHOR_EMAIL && process.env.GIT_COMMITTER_EMAIL) {
    return;
  }
  git(home, ["config", "user.name", "amalgam"], report);
  git(home, ["config", "user.email", "amalgam@localhost"], report);
}

function hasCommits(home: string): boolean {
  return readGit(home, ["rev-parse", "--verify", "HEAD"]) !== undefined;
}

function readGit(home: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", home, ...args], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

function git(home: string, args: string[], report: InitReport): void {
  try {
    execFileSync("git", ["-C", home, ...args], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (error) {
    report.warnings.push(`git ${args[0]} failed: ${message(error)}`);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] ?? "unknown error" : String(error);
}
