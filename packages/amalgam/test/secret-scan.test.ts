import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findSecrets, preCommitHook } from "../src/secret-scan.js";

const CLEAN = `# people

- marco prefers short answers
- the deploy runs at 03:00 Europe/Rome
- API keys live in .env, never here
`;

describe("findSecrets", () => {
  it("passes ordinary prose", () => {
    expect(findSecrets(CLEAN)).toEqual([]);
  });

  it("flags obvious key shapes", () => {
    expect(findSecrets("AKIAIOSFODNN7EXAMPLE")).toContain("AWS access key id");
    expect(findSecrets("sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAA")).toContain("provider api key (sk-)");
    expect(findSecrets("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")).toContain("GitHub token");
    expect(findSecrets("-----BEGIN OPENSSH PRIVATE KEY-----")).toContain("private key block");
    expect(findSecrets("TELEGRAM_BOT_TOKEN=8f2b19d0c4a7e6135b90ff2231aa")).toContain("assigned secret");
  });
});

describe("the generated pre-commit hook", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "amalgam-hook-"));
    writeFileSync(join(dir, "pre-commit"), preCommitHook(), "utf-8");
    chmodSync(join(dir, "pre-commit"), 0o755);
    // The hook asks git for staged content; a stub answers with FAKE_STAGED.
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", "git"), '#!/bin/sh\nprintf %s "$FAKE_STAGED"\n', "utf-8");
    chmodSync(join(dir, "bin", "git"), 0o755);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function runHook(staged: string): { code: number; stderr: string } {
    try {
      execFileSync(join(dir, "pre-commit"), [], {
        env: { PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`, FAKE_STAGED: staged },
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { code: 0, stderr: "" };
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      return { code: failure.status ?? -1, stderr: failure.stderr ?? "" };
    }
  }

  it("is valid POSIX shell", () => {
    execFileSync("sh", ["-n", join(dir, "pre-commit")]);
  });

  it("lets a clean commit through", () => {
    expect(runHook(CLEAN).code).toBe(0);
  });

  it("blocks a commit carrying a key, with a readable reason", () => {
    const result = runHook("+ANTHROPIC_KEY=sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAA\n");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("looks like a secret");
    expect(result.stderr).toContain("--no-verify");
  });
});
