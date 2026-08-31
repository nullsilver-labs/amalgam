import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { commitFile, isCommittablePath } from "../src/memory-commit.js";
import { initHome } from "../src/init.js";

const HOME = "/home/agent/.amalgam";
const CWD = "/workspace";

describe("what gets committed", () => {
  it("commits memory and skills", () => {
    expect(isCommittablePath(HOME, CWD, `${HOME}/memory/INDEX.md`)).toBe(true);
    expect(isCommittablePath(HOME, CWD, `${HOME}/memory/people/marco.md`)).toBe(true);
    expect(isCommittablePath(HOME, CWD, `${HOME}/skills/deploy.md`)).toBe(true);
  });

  it("leaves everything else alone", () => {
    expect(isCommittablePath(HOME, CWD, `${HOME}/SOUL.md`)).toBe(false);
    expect(isCommittablePath(HOME, CWD, `${HOME}/sessions/nightly.jsonl`)).toBe(false);
    expect(isCommittablePath(HOME, CWD, `${HOME}/auth.json`)).toBe(false);
    expect(isCommittablePath(HOME, CWD, "/workspace/notes.md")).toBe(false);
    expect(isCommittablePath(HOME, CWD, "/etc/passwd")).toBe(false);
  });

  it("resolves a relative path against the session cwd, not against home", () => {
    expect(isCommittablePath(HOME, `${HOME}/memory`, "people.md")).toBe(true);
    expect(isCommittablePath(HOME, CWD, "memory/people.md")).toBe(false);
  });

  it("is not fooled by a sibling directory that starts the same way", () => {
    expect(isCommittablePath(HOME, CWD, `${HOME}/memory-backup/old.md`)).toBe(false);
    expect(isCommittablePath(HOME, CWD, `${HOME}/memory/../auth.json`)).toBe(false);
  });
});

describe("commitFile", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "amalgam-commit-"));
    initHome(home);
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("commits a memory file and says so", async () => {
    const file = join(home, "memory", "people.md");
    writeFileSync(file, "# people\n\n- marco prefers short answers\n", "utf-8");

    expect(await commitFile(home, file)).toBe("committed");

    const log = execFileSync("git", ["-C", home, "log", "--oneline", "-1"], { encoding: "utf-8" });
    expect(log).toContain("memory: memory/people.md");
    expect(execFileSync("git", ["-C", home, "status", "--porcelain"], { encoding: "utf-8" })).toBe("");
  });

  it("does nothing when the file did not change", async () => {
    const file = join(home, "memory", "INDEX.md");
    expect(await commitFile(home, file)).toBe("unchanged");
  });
});
