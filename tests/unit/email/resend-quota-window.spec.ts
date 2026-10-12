/**
 * Resend adapter: a quota failure names WHICH window ran out.
 *
 * The provider answers `daily_quota_exceeded` or `monthly_quota_exceeded`; both
 * are `kind: 'quota_exceeded'`, but they heal on different clocks (the next UTC
 * midnight vs. the next billing period), so callers that schedule a retry need
 * the distinction. The field is additive: callers that ignore it behave as before.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ResendProvider, quotaWindowFor } from '../../../server/lib/email/providers/resend';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const send = () => new ResendProvider({ apiKey: 're_test' })
  .sendEmail({ from: 'a@x.com', to: 'b@y.com', subject: 'Hi', html: '<p>hi</p>' });

describe('quotaWindowFor', () => {
  it('maps the two Resend quota error names', () => {
    expect(quotaWindowFor('daily_quota_exceeded')).toBe('daily');
    expect(quotaWindowFor('monthly_quota_exceeded')).toBe('monthly');
  });

  it('answers undefined for anything else', () => {
    expect(quotaWindowFor('rate_limit_exceeded')).toBeUndefined();
    expect(quotaWindowFor(undefined)).toBeUndefined();
  });
});

describe('ResendProvider.sendEmail quota window', () => {
  it('reports the daily window on daily_quota_exceeded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ name: 'daily_quota_exceeded', message: 'Daily.' }, 429)));
    expect(await send()).toEqual({ ok: false, error: 'Daily.', kind: 'quota_exceeded', quotaWindow: 'daily' });
  });

  it('reports the monthly window on monthly_quota_exceeded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ name: 'monthly_quota_exceeded', message: 'Monthly.' }, 429)));
    expect(await send()).toEqual({ ok: false, error: 'Monthly.', kind: 'quota_exceeded', quotaWindow: 'monthly' });
  });

  it('carries no quotaWindow on other failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ name: 'rate_limit_exceeded', message: 'Slow.' }, 429)));
    const res = await send();
    expect('quotaWindow' in res).toBe(false);
  });
});
