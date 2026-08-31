import { describe, expect, it } from "vitest";

import {
  applyNonInteractiveEnv,
  FALLBACK_BASH_TIMEOUT_SECONDS,
  NON_INTERACTIVE_ENV,
  nonInteractiveSpawnHook,
  resolveDefaultTimeoutSeconds,
  withDefaultTimeout,
} from "../src/bash-liveness.js";
import type { BashOperations } from "@earendil-works/pi-coding-agent";

describe("non-interactive environment", () => {
  it("injects everything §3.4 lists", () => {
    const env = applyNonInteractiveEnv({});
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GIT_SSH_COMMAND).toBe("ssh -o BatchMode=yes -o ConnectTimeout=10");
    expect(env.SSH_ASKPASS).toBe("/bin/false");
    expect(env.DEBIAN_FRONTEND).toBe("noninteractive");
    expect(env.PAGER).toBe("cat");
    expect(env.GIT_PAGER).toBe("cat");
    expect(env.EDITOR).toBe("true");
    expect(env.CI).toBe("1");
  });

  it("keeps the rest of the environment, PATH above all", () => {
    const env = applyNonInteractiveEnv({ PATH: "/usr/bin:/bin", HOME: "/root", LANG: "C.UTF-8" });
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.HOME).toBe("/root");
    expect(env.LANG).toBe("C.UTF-8");
  });

  it("wins over a user value, because that value is the hang", () => {
    const env = applyNonInteractiveEnv({ GIT_TERMINAL_PROMPT: "1", PAGER: "less" });
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.PAGER).toBe("cat");
  });

  it("passes command and cwd through untouched", () => {
    const context = nonInteractiveSpawnHook({ command: "git push", cwd: "/workspace", env: { PATH: "/bin" } });
    expect(context.command).toBe("git push");
    expect(context.cwd).toBe("/workspace");
    expect(Object.keys(NON_INTERACTIVE_ENV).every((key) => key in context.env)).toBe(true);
  });
});

describe("default timeout", () => {
  it("falls back to 300s without AMALGAM_BASH_TIMEOUT", () => {
    expect(resolveDefaultTimeoutSeconds({})).toBe(FALLBACK_BASH_TIMEOUT_SECONDS);
  });

  it("reads AMALGAM_BASH_TIMEOUT in seconds", () => {
    expect(resolveDefaultTimeoutSeconds({ AMALGAM_BASH_TIMEOUT: "45" })).toBe(45);
  });

  it("ignores nonsense rather than disabling the timeout", () => {
    expect(resolveDefaultTimeoutSeconds({ AMALGAM_BASH_TIMEOUT: "soon" })).toBe(FALLBACK_BASH_TIMEOUT_SECONDS);
    expect(resolveDefaultTimeoutSeconds({ AMALGAM_BASH_TIMEOUT: "0" })).toBe(FALLBACK_BASH_TIMEOUT_SECONDS);
    expect(resolveDefaultTimeoutSeconds({ AMALGAM_BASH_TIMEOUT: "-1" })).toBe(FALLBACK_BASH_TIMEOUT_SECONDS);
  });
});

function recordingOperations(): { operations: BashOperations; timeouts: Array<number | undefined> } {
  const timeouts: Array<number | undefined> = [];
  const operations: BashOperations = {
    exec: async (_command, _cwd, options) => {
      timeouts.push(options.timeout);
      return { exitCode: 0 };
    },
  };
  return { operations, timeouts };
}

describe("withDefaultTimeout", () => {
  it("applies the default when the model omits one", async () => {
    const { operations, timeouts } = recordingOperations();
    await withDefaultTimeout(operations, 300).exec("tail -f log", "/tmp", { onData: () => {} });
    expect(timeouts).toEqual([300]);
  });

  it("lets a model-supplied timeout win", async () => {
    const { operations, timeouts } = recordingOperations();
    await withDefaultTimeout(operations, 300).exec("npm ci", "/tmp", { onData: () => {}, timeout: 900 });
    expect(timeouts).toEqual([900]);
  });

  it("leaves the other exec options alone", async () => {
    const seen: Array<{ command: string; cwd: string; env?: NodeJS.ProcessEnv }> = [];
    const operations: BashOperations = {
      exec: async (command, cwd, options) => {
        seen.push({ command, cwd, env: options.env });
        return { exitCode: 0 };
      },
    };
    await withDefaultTimeout(operations, 30).exec("ls", "/workspace", { onData: () => {}, env: { PATH: "/bin" } });
    expect(seen).toEqual([{ command: "ls", cwd: "/workspace", env: { PATH: "/bin" } }]);
  });
});
