/** Telegram rejects a sendMessage over this many UTF-16 code units. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

/**
 * Split a reply into messages Telegram will accept, preferring line boundaries.
 * Text under the limit comes back untouched, as one message.
 */
export function splitMessage(text: string, limit: number = TELEGRAM_MESSAGE_LIMIT): string[] {
  if (text.trim() === "") return [];
  if (text.length <= limit) return [text];

  const parts: string[] = [];
  let rest = text;

  while (rest.length > limit) {
    // A newline at index 0 would yield an empty message, so require idx > 0.
    const newline = rest.slice(0, limit + 1).lastIndexOf("\n");
    const cut = newline > 0 ? newline : hardCut(rest, limit);
    parts.push(rest.slice(0, cut));
    // Drop the newline we split on; keep every other character.
    rest = newline > 0 ? rest.slice(cut + 1) : rest.slice(cut);
  }
  parts.push(rest);

  // Telegram rejects a whitespace-only message, and it says nothing anyway.
  return parts.filter((part) => part.trim() !== "");
}

/** Never cut between the two halves of a surrogate pair; it corrupts the emoji. */
function hardCut(text: string, limit: number): number {
  const last = text.charCodeAt(limit - 1);
  const isHighSurrogate = last >= 0xd800 && last <= 0xdbff;
  return isHighSurrogate && limit > 1 ? limit - 1 : limit;
}
