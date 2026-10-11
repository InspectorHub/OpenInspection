/**
 * POST /api/integrations/test-steps/{email,stripe}: recipient safety, per-step
 * persistence, rate limiting. Storage helpers are mocked; the real step runner
 * runs against a fake fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';

const h = vi.hoisted(() => ({
    record: vi.fn(async (..._a: unknown[]) => undefined),
    sessionEmailArgs: [] as unknown[][],
}));
vi.mock('../../../server/lib/integration-test-results', async (orig) => ({
    ...(await orig<typeof import('../../../server/lib/integration-test-results')>()),
    recordIntegrationTest: h.record,
}));
vi.mock('../../../server/lib/route-helpers', async (orig) => {
    const fakeDb = { select: () => ({ from: () => ({ where: () => ({ get: async () => ({ p: 'resend' }) }) }) }) };
    return { ...(await orig<typeof import('../../../server/lib/route-helpers')>()), getDrizzle: () => fakeDb, createDrizzle: () => fakeDb };
});
vi.mock('../../../server/lib/integration/email-test-store', () => ({
    readSessionEmail: async (...a: unknown[]) => { h.sessionEmailArgs.push(a); return 'session-user@example.com'; },
    readLastSend: async () => null,
    writeLastSend: async () => undefined,
    lookupResendDelivery: async () => 'none',
}));

import routes from '../../../server/api/integrations-test-steps';

const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const identity = { senderEmail: 'hello@mail.example.com', senderDisplayName: 'Acme', companyName: null, replyTo: 'r@example.com' };

function app(role = 'owner') {
    const a = new OpenAPIHono<HonoConfig>();
    a.onError((err, c) => c.json({ success: false }, ((err as { status?: number }).status ?? 500) as 429));
    a.use('*', async (c, next) => {
        const set = (c as unknown as { set(k: string, v: unknown): void }).set.bind(c);
        set('userRole', role);
        set('tenantId', 'tenant-1');
        set('user', { sub: 'user-1' });
        set('services', { branding: { getEmailIdentity: async () => identity } });
        await next();
    });
    a.route('/api/integrations/test-steps', routes);
    return a;
}
const post = (path: string, body: unknown, env: Record<string, unknown> = {}, role?: string) =>
    app(role).request(`/api/integrations/test-steps/${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }, { DB: {}, JWT_SECRET: 'x'.repeat(32), RESEND_API_KEY: 're_fake', ...env });

let sends: Array<Record<string, unknown>>;
beforeEach(() => {
    h.record.mockClear();
    h.sessionEmailArgs.length = 0;
    sends = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/domains')) return json({ data: [{ name: 'mail.example.com', status: 'verified' }] }, 200);
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        if (Object.keys(body).length === 0) return json({}, 422);
        sends.push(body);
        return json({ id: 'msg_1' }, 200);
    }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('email send_test recipient', () => {
    it('mails the signed-in user and looks the address up by verified tenant + user id', async () => {
        const res = await post('email', { step: 'send_test' });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ success: true, data: { step: 'send_test', status: 'pass', provider: 'resend' } });
        expect(sends).toHaveLength(1);
        expect(sends[0]).toMatchObject({ to: 'session-user@example.com', reply_to: 'r@example.com' });
        expect(h.sessionEmailArgs[0]!.slice(1)).toEqual(['tenant-1', 'user-1']);
    });

    it('NEGATIVE CONTROL: recipient-shaped fields in the body are ignored', async () => {
        const res = await post('email', {
            step: 'send_test', to: 'victim@example.org', email: 'victim@example.org', recipient: 'victim@example.org',
            tenantId: 'other-tenant', userId: 'other-user',
        });
        expect(res.status).toBe(200);
        expect(sends).toHaveLength(1);
        expect(sends[0]!.to).toBe('session-user@example.com');
        expect(JSON.stringify(sends)).not.toContain('victim@example.org');
        expect(h.sessionEmailArgs[0]!.slice(1)).toEqual(['tenant-1', 'user-1']);
    });

    it('rejects an unknown step id', async () => {
        expect((await post('email', { step: 'nope' })).status).toBe(400);
    });

    it('is closed to inspectors', async () => {
        expect((await post('email', { step: 'key_valid' }, {}, 'inspector')).status).toBeGreaterThanOrEqual(401);
        expect(sends).toHaveLength(0);
    });
});

describe('step persistence', () => {
    it('records a decided step with its step id', async () => {
        await post('email', { step: 'key_valid' });
        expect(h.record.mock.calls[0]![1]).toMatchObject({
            tenantId: 'tenant-1', target: 'email', provider: 'resend', ok: true, step: 'key_valid', testedByUserId: 'user-1',
        });
    });
    it('does not record a skipped step', async () => {
        await post('email', { step: 'quota' });
        expect(h.record).not.toHaveBeenCalled();
    });
    it('reports a missing key in-band as a failed step', async () => {
        const res = await post('email', { step: 'key_valid' }, { RESEND_API_KEY: undefined });
        expect(await res.json()).toMatchObject({ data: { status: 'fail', detail: 'No Resend API key is saved.' } });
    });
});

describe('rate limit', () => {
    it('429 when the limiter denies, keyed by tenant', async () => {
        const limit = vi.fn(async () => ({ success: false }));
        const res = await post('email', { step: 'key_valid' }, { RATE_LIMITER: { limit } });
        expect(res.status).toBe(429);
        expect(limit).toHaveBeenCalledWith({ key: 'integration-test-step:tenant-1' });
    });
});

describe('stripe route', () => {
    it('without a stored key, key_valid fails in-band and is recorded for stripe', async () => {
        const res = await post('stripe', { step: 'key_valid' });
        expect(await res.json()).toMatchObject({ data: { step: 'key_valid', status: 'fail', provider: null } });
        expect(h.record.mock.calls[0]![1]).toMatchObject({ target: 'stripe', step: 'key_valid', ok: false });
    });
});
