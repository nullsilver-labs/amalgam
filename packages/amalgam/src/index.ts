/**
 * Library surface. The CLI is the product; this exists so the gateway package
 * and tests can reuse the same pieces instead of copying them.
 */
export {
  applyNonInteractiveEnv,
  createAmalgamBashTool,
  FALLBACK_BASH_TIMEOUT_SECONDS,
  NON_INTERACTIVE_ENV,
  nonInteractiveSpawnHook,
  resolveDefaultTimeoutSeconds,
  withDefaultTimeout,
} from "./bash-liveness.js";
export { doctor, parseMounts } from "./doctor.js";
export { amalgamHome, homePaths, isInside, packageRoot, sessionFile } from "./home.js";
export { type InitReport, initHome } from "./init.js";
export { commitFile, isCommittablePath, memoryCommitExtension } from "./memory-commit.js";
export { findSecrets, preCommitHook, SECRET_PATTERNS } from "./secret-scan.js";
export { createAmalgamRuntime, createModelRuntime, identityFiles, systemPrompt, TOOLS } from "./session.js";
