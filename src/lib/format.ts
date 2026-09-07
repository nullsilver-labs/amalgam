import type { Conversation } from './types';

/** "Good morning" / "Good afternoon" / "Good evening" for the empty state. */
export function greeting(now = new Date()): string {
  const hour = now.getHours();
  return hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export interface ConversationGroup { label: string; items: Conversation[] }

/**
 * Buckets a newest-first list the way every chat client does: Today,
 * Yesterday, the last week, the last month, then one bucket per month.
 */
export function groupByDate(conversations: Conversation[], now = new Date()): ConversationGroup[] {
  const day = 86_400_000;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const groups: ConversationGroup[] = [];
  for (const c of conversations) {
    const when = new Date(c.updated_at).getTime();
    const age = start - when;
    let label: string;
    if (age < 0 || when >= start) label = 'Today';
    else if (age < day) label = 'Yesterday';
    else if (age < day * 7) label = 'Previous 7 days';
    else if (age < day * 30) label = 'Previous 30 days';
    else label = new Date(when).toLocaleDateString('en-GB', { month: 'long', year: when < start - day * 365 ? 'numeric' : undefined });
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(c);
    else groups.push({ label, items: [c] });
  }
  return groups;
}

/** The model's own name, without the provider prefix amalgam adds to IDs. */
export function modelName(id: string | null | undefined): string {
  if (!id) return '';
  const colon = id.indexOf(':');
  return colon >= 0 ? id.slice(colon + 1) : id;
}

/** Shortcut hints follow the platform: ⌘ on a Mac, Ctrl elsewhere. */
export function modifier(): string {
  if (typeof navigator === 'undefined') return '⌘';
  return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
}

/** A token count the way windows are quoted: 128000 → "128k". */
export function formatTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/** How long a model worked: "4s", "1m 12s". Never less than a second — it did something. */
export function formatDuration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
