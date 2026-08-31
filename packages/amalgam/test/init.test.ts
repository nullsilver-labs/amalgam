import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HOOK_MARKER } from "../src/secret-scan.js";
import { initHome } from "../src/init.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "amalgam-init-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function git(args: string[]): string {
  return execFileSync("git", ["-C", home, ...args], { encoding: "utf-8" }).trim();
}

describe("amalgam init", () => {
  it("bootstraps an identity directory", () => {
    const report = initHome(home);

    expect(report.warnings).toEqual([]);
    expect(existsSync(join(home, "SOUL.md"))).toBe(true);
    expect(existsSync(join(home, "memory", "INDEX.md"))).toBe(true);
    expect(existsSync(join(home, "skills", "learn.md"))).toBe(true);
    expect(existsSync(join(home, "sessions"))).toBe(true);
    expect(existsSync(join(home, ".git"))).toBe(true);
  });

  it("gitignores sessions and credentials", () => {
    initHome(home);
    const ignored = readFileSync(join(home, ".gitignore"), "utf-8");
    expect(ignored).toContain("sessions/");
    expect(ignored).toContain("auth.json");
    expect(ignored).toContain("models.json");
    expect(ignored).toContain("models-store.json");
  });

  it("installs an executable secret-scan pre-commit hook", () => {
    initHome(home);
    const hook = join(home, ".git", "hooks", "pre-commit");
    expect(readFileSync(hook, "utf-8")).toContain(HOOK_MARKER);
    expect(statSync(hook).mode & 0o111).not.toBe(0);
  });

  it("makes an initial commit", () => {
    initHome(home);
    expect(git(["log", "--oneline"])).toContain("initial identity");
    expect(git(["status", "--porcelain"])).toBe("");
  });

  it("leaves user edits alone on a second run", () => {
    initHome(home);
    writeFileSync(join(home, "SOUL.md"), "# mine\n", "utf-8");
    writeFileSync(join(home, "memory", "people.md"), "# people\n", "utf-8");

    const second = initHome(home);

    expect(readFileSync(join(home, "SOUL.md"), "utf-8")).toBe("# mine\n");
    expect(readFileSync(join(home, "memory", "people.md"), "utf-8")).toBe("# people\n");
    expect(second.created).toEqual([]);
    expect(second.kept).toContain("SOUL.md");
  });

  it("restores a default the user deleted", () => {
    initHome(home);
    rmSync(join(home, "skills", "learn.md"));

    const second = initHome(home);

    expect(existsSync(join(home, "skills", "learn.md"))).toBe(true);
    expect(second.created).toContain(join("skills", "learn.md"));
  });
});
