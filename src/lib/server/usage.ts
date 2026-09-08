import type { UsageSummary } from '$lib/types';

/*
 * The arithmetic behind Settings › Usage, kept beside the route rather than in
 * it: a route file may export handlers and nothing else.
 */

const DAY = 86_400_000;

/** The periods a summary may be asked for, newest window first. */
export const USAGE_PERIODS: UsageSummary['period'][] = ['today', 'week', 'month', 'all'];

/** A zone name the runtime knows, or undefined: the browser's, never trusted further than that. */
export function knownZone(name: string | null | undefined): string | undefined {
  if (!name || name.length > 64) return undefined;
  try { new Intl.DateTimeFormat('en-US', { timeZone: name }); return name; }
  catch { return undefined; }
}

/** The wall-clock parts of `at` in `zone`, as the UTC instant that would show them. */
function wallClock(at: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
}

/** Midnight at the start of `at`'s day in `zone`, as an instant — the zone's offset read twice, for a day that changes it. */
export function startOfDay(at: Date, zone: string): Date {
  const wall = wallClock(at, zone);
  const midnight = Date.UTC(new Date(wall).getUTCFullYear(), new Date(wall).getUTCMonth(), new Date(wall).getUTCDate());
  let guess = new Date(midnight - (wall - at.getTime()));
  const offset = wallClock(guess, zone) - guess.getTime();
  guess = new Date(midnight - offset);
  return guess;
}

/**
 * Where a period begins, or null for all time. Today is the day as the person
 * asking reckons it — their browser's zone, when it says — not the last 24
 * hours, and not this server's clock: someone asking what today cost means
 * since their morning.
 */
export function periodStart(period: UsageSummary['period'], now = new Date(), zone?: string): Date | null {
  if (period === 'all') return null;
  if (period === 'today') return zone ? startOfDay(now, zone) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return new Date(now.getTime() - (period === 'week' ? 7 : 30) * DAY);
}

/** pg returns bigint sums as strings; nothing downstream wants to discover that. */
export function counted(value: unknown): number {
  return Number(value ?? 0);
}
