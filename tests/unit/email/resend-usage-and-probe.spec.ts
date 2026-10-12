/**
 * Resend adapter: usage headers, rate-limit classification, reachability-aware
 * probes, domain listing, restricted (send-only) keys, and the /resend/test route.
 * All network access is stubbed.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { ResendProvider, classifyResendError } from '../../../server/lib/email/providers/resend';
import type { HonoConfig } from '../../../server/types/hono';

const recordMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined));
vi.mock('../../../server/lib/integration-test-results', async (orig) => {
  const actual = await orig<typeof import('../../../server/lib/integration-test-results')>();
  return { ...actual, recordIntegrationTest: recordMock };
});

import integrationsRoutes from '../../../server/api/integrations';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const SEND_ARGS = { from: 'a@x.com', to: 'b@y.com', subject: 'Hi', html: '<p>hi</p>' };
const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const send = () => new ResendProvider({ apiKey: 're_test' }).sendEmail(SEND_ARGS);
const networkDown = () => vi.fn(async () => { throw new TypeError('fetch failed'); });

describe('ResendProvider.sendEmail usage headers', () => {
  it('reports both counters on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ id: 'e1' }, 200, {
      'x-resend-daily-quota': '12', 'x-resend-monthly-quota': '340',
    })));
    expect(await send()).toEqual({ ok: true, id: 'e1', usage: { dailyUsed: 12, monthlyUsed: 340 } });
  });

  it('reports only the monthly counter when the daily header is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ id: 'e1' }, 200, { 'x-resend-monthly-quota': '7' })));
    expect(await send()).toEqual({ ok: true, id: 'e1', usage: { monthlyUsed: 7 } });
  });

  it('omits the usage key entirely when neither header is present', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ id: 'e1' }, 200)));
    const res = await send();
    expect(res).toEqual({ ok: true, id: 'e1' });
    expect('usage' in res).toBe(false);
  });

  it('ignores garbage, negative and fractional values', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ id: 'e1' }, 200, {
      'x-resend-daily-quota': 'abc', 'x-resend-monthly-quota': '-5',
    })));
    const res = await send();
    expect('usage' in res).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => json({ id: 'e1' }, 200, {
      'x-resend-daily-quota': '1.5', 'x-resend-monthly-quota': '3',
    })));
    expect(await send()).toEqual({ ok: true, id: 'e1', usage: { monthlyUsed: 3 } });
  });

  it('attaches usage to a quota-exceeded 429 failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(
      { name: 'daily_quota_exceeded', message: 'Daily quota exceeded.' }, 429,
      { 'x-resend-daily-quota': '100', 'x-resend-monthly-quota': '2900' },
    )));
    expect(await send()).toEqual({
      ok: false, error: 'Daily quota exceeded.', kind: 'quota_exceeded', quotaWindow: 'daily',
      usage: { dailyUsed: 100, monthlyUsed: 2900 },
    });
  });
});

describe('Resend rate-limit classification', () => {
  it('classifies 429 rate_limit_exceeded as rate_limited', () => {
    expect(classifyResendError(429, 'rate_limit_exceeded', 'Too many requests.')).toBe('rate_limited');
  });

  it('keeps quota 429s as quota_exceeded', () => {
    expect(classifyResendError(429, 'daily_quota_exceeded', 'x')).toBe('quota_exceeded');
    expect(classifyResendError(429, 'monthly_quota_exceeded', 'x')).toBe('quota_exceeded');
  });

  it('surfaces retry-after seconds on a rate-limited failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(
      { name: 'rate_limit_exceeded', message: 'Too many requests.' }, 429, { 'retry-after': '2' },
    )));
    expect(await send()).toEqual({
      ok: false, error: 'Too many requests.', kind: 'rate_limited', retryAfterSeconds: 2,
    });
  });

  it('omits retryAfterSeconds when the header is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ name: 'rate_limit_exceeded', message: 'Slow down.' }, 429)));
    const res = await send();
    expect(res).toEqual({ ok: false, error: 'Slow down.', kind: 'rate_limited' });
    expect('retryAfterSeconds' in res).toBe(false);
  });

  it('ignores garbage, negative and oversized retry-after values', async () => {
    for (const bad of ['soon', '-3', '86401', '1.5']) {
      vi.stubGlobal('fetch', vi.fn(async () => json({ name: 'rate_limit_exceeded', message: 'm' }, 429, { 'retry-after': bad })));
      const res = await send();
      expect('retryAfterSeconds' in res).toBe(false);
    }
  });
});

describe('ResendProvider.probeApiKey', () => {
  const probe = () => new ResendProvider({ apiKey: 're_test' }).probeApiKey();

  it('reports reachable with the HTTP status when a response arrives', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 422)));
    expect(await probe()).toEqual({ valid: true, status: 422, reachable: true });
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)));
    expect(await probe()).toEqual({ valid: false, status: 401, reachable: true });
  });

  it('flags a network failure as unreachable but keeps valid:true for save flows', async () => {
    vi.stubGlobal('fetch', networkDown());
    expect(await probe()).toEqual({ valid: true, status: null, reachable: false });
  });
});

describe('ResendProvider.listDomains', () => {
  const list = () => new ResendProvider({ apiKey: 're_test' }).listDomains();

  it('counts only verified domains among mixed statuses (case-insensitive)', async () => {
    const fetchMock = vi.fn(async (_url: string) => json({ data: [
      { name: 'a.com', status: 'verified' },
      { name: 'b.com', status: 'Verified' },
      { name: 'c.com', status: 'pending' },
      { name: 'd.com', status: 'failed' },
    ] }, 200));
    vi.stubGlobal('fetch', fetchMock);
    expect(await list()).toMatchObject({ ok: true, total: 4, verified: 2 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.resend.com/domains');
  });

  it('returns zero totals for an empty account', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [] }, 200)));
    expect(await list()).toEqual({ ok: true, total: 0, verified: 0, domains: [] });
  });

  it('reports a send-only key as restricted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ name: 'restricted_api_key', message: 'no' }, 401)));
    expect(await list()).toEqual({ ok: false, reason: 'restricted', status: 401 });
  });

  it('reports a plain 401 as an error, not restricted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ name: 'invalid_api_key', message: 'no' }, 401)));
    expect(await list()).toEqual({ ok: false, reason: 'error', status: 401 });
  });

  it('reports network failure as unreachable', async () => {
    vi.stubGlobal('fetch', networkDown());
    expect(await list()).toEqual({ ok: false, reason: 'unreachable', status: null });
  });

  it('reports a 500 as an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 500)));
    expect(await list()).toEqual({ ok: false, reason: 'error', status: 500 });
  });
});

describe('ResendProvider.countVerifiedDomains (compat)', () => {
  const count = () => new ResendProvider({ apiKey: 're_test' }).countVerifiedDomains();

  it('returns the verified count', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [
      { name: 'a.com', status: 'verified' }, { name: 'b.com', status: 'pending' },
    ] }, 200)));
    expect(await count()).toBe(1);
  });

  it('returns 0 for restricted, unreachable and error outcomes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ name: 'restricted_api_key' }, 401)));
    expect(await count()).toBe(0);
    vi.stubGlobal('fetch', networkDown());
    expect(await count()).toBe(0);
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 500)));
    expect(await count()).toBe(0);
  });
});

describe('ResendProvider.validateCredentials', () => {
  const validate = () => new ResendProvider({ apiKey: 're_test' }).validateCredentials();

  it('accepts a send-only key as ok with restricted:true', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ name: 'restricted_api_key', message: 'no' }, 401)));
    expect(await validate()).toEqual({ ok: true, restricted: true });
  });

  it('keeps a plain 401 invalid with the same message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ name: 'invalid_api_key' }, 401)));
    expect(await validate()).toEqual({ ok: false, error: 'Resend 401' });
  });

  it('keeps a 401 with an unparseable body invalid', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
    expect(await validate()).toEqual({ ok: false, error: 'Resend 401' });
  });

  it('keeps a network error invalid', async () => {
    vi.stubGlobal('fetch', networkDown());
    expect(await validate()).toEqual({ ok: false, error: 'fetch failed' });
  });

  it('keeps a plain success as { ok: true }', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [] }, 200)));
    expect(await validate()).toEqual({ ok: true });
  });
});

describe('POST /api/integrations/resend/test', () => {
  beforeEach(() => { recordMock.mockClear(); });

  function call(env: Record<string, unknown> = {}) {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
      c.set('userRole', 'owner');
      c.set('tenantId', 'tenant-resend-test');
      await next();
    });
    app.route('/api/integrations', integrationsRoutes);
    return app.request('/api/integrations/resend/test', { method: 'POST' },
      { JWT_SECRET: 'x'.repeat(32), DB: {}, ...env });
  }
  const recorded = () => recordMock.mock.calls.at(-1)?.[1] as { ok: boolean; detail: string } | undefined;

  /** Route fetch by URL: POST /emails is the probe, GET /domains the listing. */
  function stubResend(probe: () => Response | Promise<Response>, domains: () => Response | Promise<Response>) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/domains') ? domains() : probe())));
  }

  it('503 RESEND_NOT_CONFIGURED when no key is set', async () => {
    const res = await call({});
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('RESEND_NOT_CONFIGURED');
  });

  it('502 RESEND_KEY_INVALID when Resend rejects the key', async () => {
    stubResend(() => json({}, 401), () => json({}, 401));
    const res = await call({ RESEND_API_KEY: 're_bad' });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('RESEND_KEY_INVALID');
    expect(recorded()?.ok).toBe(false);
  });

  it('503 RESEND_UNREACHABLE and a failed record when Resend cannot be reached', async () => {
    vi.stubGlobal('fetch', networkDown());
    const res = await call({ RESEND_API_KEY: 're_x' });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { success: boolean; error: { code: string; message: string } };
    expect(body.error).toEqual({ code: 'RESEND_UNREACHABLE', message: 'Could not reach Resend.' });
    expect(recorded()).toMatchObject({ ok: false, detail: 'Could not reach Resend.' });
    expect(recorded()?.detail).not.toMatch(/valid/i);
  });

  it('treats a send-only key as success with domains: 0', async () => {
    stubResend(() => json({}, 422), () => json({ name: 'restricted_api_key', message: 'no' }, 401));
    const res = await call({ RESEND_API_KEY: 're_sendonly' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { domains: 0 } });
    expect(recorded()).toMatchObject({
      ok: true, detail: 'Resend key valid (send-only key; sender domains cannot be checked).',
    });
  });

  it('counts verified domains only and mentions the unverified ones', async () => {
    stubResend(() => json({}, 422), () => json({ data: [
      { name: 'a.com', status: 'verified' }, { name: 'b.com', status: 'verified' },
      { name: 'c.com', status: 'pending' },
    ] }, 200));
    const res = await call({ RESEND_API_KEY: 're_full' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { domains: 2 } });
    expect(recorded()?.ok).toBe(true);
    expect(recorded()?.detail).toBe('Resend key valid · 2 verified domains (1 not yet verified).');
  });

  it('reports a single verified domain with no unverified remainder', async () => {
    stubResend(() => json({}, 422), () => json({ data: [{ name: 'a.com', status: 'verified' }] }, 200));
    const res = await call({ RESEND_API_KEY: 're_full' });
    expect(res.status).toBe(200);
    expect(recorded()?.detail).toBe('Resend key valid · 1 verified domain.');
  });

  it('reports a key with no verified domains without a count claim', async () => {
    stubResend(() => json({}, 422), () => json({ data: [{ name: 'c.com', status: 'pending' }] }, 200));
    const res = await call({ RESEND_API_KEY: 're_full' });
    expect(await res.json()).toEqual({ success: true, data: { domains: 0 } });
    expect(recorded()?.detail).toBe('Resend key valid · no verified domains (1 not yet verified).');
  });
});

describe('ResendProvider.sendEmail with a response that has no headers object', () => {
  // Real fetch responses always carry headers; hand-rolled test doubles for fetch often
  // do not. Reading usage must never turn such a response into a thrown TypeError.
  const bare = (ok: boolean, status: number, body: unknown) =>
    vi.fn(async () => ({ ok, status, json: async () => body, text: async () => '' }));

  it('still reports success and omits usage', async () => {
    vi.stubGlobal('fetch', bare(true, 200, { id: 'e1' }));
    expect(await send()).toEqual({ ok: true, id: 'e1' });
  });

  it('still classifies a failure and omits usage and retry-after', async () => {
    vi.stubGlobal('fetch', bare(false, 429, { name: 'rate_limit_exceeded', message: 'slow down' }));
    const res = await send();
    expect(res).toMatchObject({ ok: false, kind: 'rate_limited' });
    expect('usage' in res).toBe(false);
    expect('retryAfterSeconds' in res).toBe(false);
  });
});
