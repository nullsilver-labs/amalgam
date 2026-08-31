/**
 * A pre-commit scan for ~/.amalgam. The identity directory is a git repository
 * the user is expected to push somewhere, and the agent writes to it
 * unsupervised, so an obvious key shape is worth blocking.
 *
 * The patterns are written once, as strings, and used twice: by findSecrets()
 * in tests and by the generated shell hook at commit time. They must stay
 * POSIX ERE and must not contain a single quote, because the hook embeds them
 * in single-quoted arguments to `grep -E`.
 */

export interface SecretPattern {
  name: string;
  source: string;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  { name: "private key block", source: "-----BEGIN [A-Z ]*PRIVATE KEY-----" },
  { name: "AWS access key id", source: "(AKIA|ASIA)[0-9A-Z]{16}" },
  { name: "provider api key (sk-)", source: "sk-[A-Za-z0-9_-]{20,}" },
  { name: "GitHub token", source: "gh[pousr]_[A-Za-z0-9]{30,}" },
  { name: "Slack token", source: "xox[abprs]-[A-Za-z0-9-]{10,}" },
  { name: "Google API key", source: "AIza[0-9A-Za-z_-]{35}" },
  { name: "assigned secret", source: "(API_?KEY|SECRET|TOKEN|PASSWORD)[A-Z_]*=[A-Za-z0-9/+_-]{20,}" },
];

/** Names of the patterns that match. Empty means the text looks clean. */
export function findSecrets(text: string): string[] {
  return SECRET_PATTERNS.filter(({ source }) => new RegExp(source, "i").test(text)).map(({ name }) => name);
}

export const HOOK_MARKER = "# amalgam secret scan";

/**
 * The hook scans staged content only, so an existing file that already
 * contains a key does not block every later commit.
 */
export function preCommitHook(): string {
  const checks = SECRET_PATTERNS.map(
    ({ name, source }) => `printf %s "$staged" | grep -Eiq -e '${source}' && reject '${name}'`,
  ).join("\n");
  return `#!/bin/sh
${HOOK_MARKER} — installed by \`amalgam init\`. Delete it if you mean to.
# Blocks a commit whose staged content looks like a credential.
set -u

reject() {
  echo "amalgam: refusing to commit, staged content looks like a secret: $1" >&2
  echo "amalgam: fix it, or commit with --no-verify if you are sure." >&2
  exit 1
}

staged=$(git diff --cached --unified=0)

${checks}

exit 0
`;
}
