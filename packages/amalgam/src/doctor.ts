/**
 * `amalgam doctor` — answers the four questions that actually go wrong:
 * where is home, is it set up, will bash come back, and (the container
 * footgun from PLAN.md §3.1) what can the agent even see?
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

import { FALLBACK_BASH_TIMEOUT_SECONDS, resolveDefaultTimeoutSeconds } from "./bash-liveness.js";
import { homePaths } from "./home.js";

export async function doctor(home: string, modelRuntime: ModelRuntime, env = process.env): Promise<void> {
  const paths = homePaths(home);

  console.log(`AMALGAM_HOME   ${home}${env.AMALGAM_HOME ? "" : "  (default)"}`);
  console.log(`initialized    ${describeInit(home)}`);

  const timeout = resolveDefaultTimeoutSeconds(env);
  const source = timeout === FALLBACK_BASH_TIMEOUT_SECONDS && !env.AMALGAM_BASH_TIMEOUT ? "default" : "AMALGAM_BASH_TIMEOUT";
  console.log(`bash timeout   ${timeout}s when the model omits one (${source})`);

  console.log("\nModels");
  const available = modelRuntime.getAvailableSnapshot();
  const configured = modelRuntime
    .getProviders()
    .filter((provider) => modelRuntime.getProviderAuthStatus(provider.id).configured);
  if (configured.length === 0) {
    console.log("  no provider configured — run `amalgam auth`");
  }
  for (const provider of configured) {
    const status = modelRuntime.getProviderAuthStatus(provider.id);
    console.log(`  ${provider.id.padEnd(20)} ${status.label ?? status.source ?? "configured"}`);
  }
  console.log(`  ${available.length} model(s) available`);

  console.log("\nContainer");
  if (!inContainer()) {
    console.log("  not in a container; the agent sees this filesystem directly");
    return;
  }
  console.log("  yes — the agent's bash sees only what is mounted below");
  for (const mount of interestingMounts()) {
    const marker = mount.mountPoint === paths.home ? "  <- identity" : "";
    console.log(`  ${mount.mountPoint.padEnd(28)} ${mount.type}${marker}`);
  }
}

function describeInit(home: string): string {
  const paths = homePaths(home);
  const missing = [paths.soul, paths.memoryIndex, join(home, ".git")].filter((path) => !existsSync(path));
  return missing.length === 0 ? "yes" : `no — run \`amalgam init\` (missing ${missing.length} of 3)`;
}

function inContainer(): boolean {
  return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
}

export interface Mount {
  mountPoint: string;
  type: string;
}

/**
 * /proc/mounts is mostly kernel bookkeeping. What a user wants to see is the
 * handful of real filesystems, which is where their bind mounts show up.
 */
const NOISE_TYPES = new Set([
  "autofs",
  "binfmt_misc",
  "bpf",
  "cgroup",
  "cgroup2",
  "configfs",
  "debugfs",
  "devpts",
  "devtmpfs",
  "efivarfs",
  "fusectl",
  "hugetlbfs",
  "mqueue",
  "nsfs",
  "proc",
  "pstore",
  "securityfs",
  "sysfs",
  "tmpfs",
  "tracefs",
]);

export function parseMounts(procMounts: string): Mount[] {
  return procMounts
    .split("\n")
    .map((line) => line.split(" "))
    .filter((fields) => fields.length >= 3)
    .map((fields) => ({ mountPoint: unescapeMount(fields[1] as string), type: fields[2] as string }))
    .filter((mount) => !NOISE_TYPES.has(mount.type))
    .filter((mount) => !mount.mountPoint.startsWith("/proc") && !mount.mountPoint.startsWith("/sys"));
}

/** /proc/mounts escapes spaces and friends as octal. */
function unescapeMount(field: string): string {
  return field.replace(/\\(\d{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
}

function interestingMounts(): Mount[] {
  try {
    return parseMounts(readFileSync("/proc/mounts", "utf-8"));
  } catch {
    return [];
  }
}
