import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const valid = { TELEGRAM_BOT_TOKEN: "123:abc", AMALGAM_ALLOWLIST: "111" };

describe("loadConfig", () => {
  it("fails fast without a bot token", () => {
    expect(() => loadConfig({ AMALGAM_ALLOWLIST: "111" })).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it("refuses to start with an empty allowlist", () => {
    expect(() => loadConfig({ ...valid, AMALGAM_ALLOWLIST: "" })).toThrow(/does not mean 'allow everyone'/);
  });

  it("defaults the rpc command and the idle timeout", () => {
    const config = loadConfig({ ...valid });
    expect(config.rpcCommand).toBe("amalgam");
    expect(config.idleMs).toBe(600_000);
    expect(config.allowlist.allows(111)).toBe(true);
  });

  it("honors AMALGAM_RPC_COMMAND and AMALGAM_IDLE_TIMEOUT", () => {
    const config = loadConfig({ ...valid, AMALGAM_RPC_COMMAND: "./fake-agent", AMALGAM_IDLE_TIMEOUT: "30" });
    expect(config.rpcCommand).toBe("./fake-agent");
    expect(config.idleMs).toBe(30_000);
  });

  it("rejects a nonsense idle timeout", () => {
    expect(() => loadConfig({ ...valid, AMALGAM_IDLE_TIMEOUT: "soon" })).toThrow(/AMALGAM_IDLE_TIMEOUT/);
  });
});
