import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Usage is read from the rows the instance kept, so the only things worth
 * pinning without a database are the ones that would be wrong silently: which
 * window a period asks for, that pg's string sums leave as numbers, and that a
 * period nobody offers is refused rather than quietly widened.
 */

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../src/lib/server/db', () => ({ database: async () => ({ query: mocks.query }) }));

const usage = await import('../src/routes/api/usage/+server');
const { periodStart, startOfDay, knownZone } = await import('../src/lib/server/usage');

/** pg hands bigint sums back as strings; the route is the last place that may be true. */
const answers = () => {
  mocks.query
    .mockResolvedValueOnce({ rows: [{ responses: '3', input_tokens: '4200', output_tokens: '900', estimated: '1' }] })
    .mockResolvedValueOnce({ rows: [{ model: 'anthropic:claude', responses: '2', input_tokens: '4000', output_tokens: '800' }] });
};
const principal = { kind: 'token', id: 'test', name: 'Test', scopes: ['read'] };
const event = (search: string, scopes: string[] = ['read']) => ({
  locals: { principal: { ...principal, scopes } },
  url: new URL(`https://app.test/api/usage${search}`)
}) as Parameters<typeof usage.GET>[0];

beforeEach(() => mocks.query.mockReset());

describe('usage route', () => {
  it('asks for a window per period, and none at all for all time', () => {
    const now = new Date('2026-09-08T14:30:00Z');
    expect(periodStart('today', now)).toEqual(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    expect(periodStart('week', now)?.toISOString()).toBe(new Date(now.getTime() - 7 * 86_400_000).toISOString());
    expect(periodStart('month', now)?.toISOString()).toBe(new Date(now.getTime() - 30 * 86_400_000).toISOString());
    expect(periodStart('all', now)).toBeNull();
    // Today in the asker's zone: midnight there, wherever this server stands; the day's own change of offset included.
    expect(periodStart('today', new Date('2026-09-08T03:30:00Z'), 'Europe/Rome')?.toISOString()).toBe('2026-09-07T22:00:00.000Z');
    expect(periodStart('today', new Date('2026-09-08T03:30:00Z'), 'America/Los_Angeles')?.toISOString()).toBe('2026-09-07T07:00:00.000Z');
    expect(startOfDay(new Date('2026-03-29T12:00:00Z'), 'Europe/Rome').toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(startOfDay(new Date('2026-01-15T12:00:00Z'), 'Asia/Kolkata').toISOString()).toBe('2026-01-14T18:30:00.000Z');
    expect(knownZone('Europe/Rome')).toBe('Europe/Rome');
    expect(knownZone('Mars/Olympus')).toBeUndefined();
    expect(knownZone('')).toBeUndefined();
  });

  it('defaults to 30 days and gives the query that period as its only bound', async () => {
    answers();
    const summary = await (await usage.GET(event(''))).json();
    expect(summary.period).toBe('month');
    expect(new Date(summary.since).getTime()).toBeCloseTo(Date.now() - 30 * 86_400_000, -4);
    for (const [sql, params] of mocks.query.mock.calls) {
      expect(sql).toContain("role = 'assistant' AND output_tokens IS NOT NULL AND created_at >= $1");
      expect(params).toEqual([summary.since]);
    }
  });

  it('counts string sums as numbers, totals and by model alike', async () => {
    answers();
    const summary = await (await usage.GET(event('?period=week'))).json();
    expect(summary).toMatchObject({
      period: 'week', responses: 3, input_tokens: 4200, output_tokens: 900, estimated: 1,
      models: [{ model: 'anthropic:claude', responses: 2, input_tokens: 4000, output_tokens: 800 }]
    });
  });

  it('bounds nothing for all time', async () => {
    answers();
    const summary = await (await usage.GET(event('?period=all'))).json();
    expect(summary.since).toBeNull();
    for (const [sql, params] of mocks.query.mock.calls) {
      expect(sql).not.toContain('created_at >=');
      expect(params).toEqual([]);
    }
  });

  it('refuses a period nobody offers, and a token without read, before touching the database', async () => {
    await expect(usage.GET(event('?period=forever'))).rejects.toMatchObject({ status: 400 });
    await expect(usage.GET(event('', ['generate']))).rejects.toMatchObject({ status: 403 });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
