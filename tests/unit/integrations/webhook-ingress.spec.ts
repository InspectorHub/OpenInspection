/**
 * Ingress guard for the unauthenticated webhooks: body cap and rate limit, both
 * answered before any tenant, KV or D1 work. Real app, real middleware chain.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { app } from '../../../server/index';
import { webhookIngressGuard } from '../../../server/lib/middleware/webhook-ingress';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import { logger } from '../../../server/lib/logger';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { TENANT_SLUG, type Harness } from '../helpers/tenant-email-harness';
import { webhookHarness } from '../helpers/webhook-secrets-fixtures';

const T = { timeout: 60_000 };
const QBO_MAX = 256 * 1024;
const STRIPE_MAX = 1024 * 1024;
const QBO_PATH = '/webhooks/quickbooks';
const STRIPE_PATH = `/webhooks/stripe/${TENANT_SLUG}`;
const PROVIDER_MAX = 256 * 1024;
const PROVIDER_PATHS = [
    `/webhooks/sms/inbound/${TENANT_SLUG}`,
    `/webhooks/sms/status/${TENANT_SLUG}`,
    `/webhooks/compliance-status/twilio/${TENANT_SLUG}`,
    `/webhooks/email/resend/${TENANT_SLUG}`,
] as const;

/** Counts every D1 statement prepared and every KV read the request causes. */
function watchLookups(h: Harness) {
    let db = 0;
    const real = h.env.DB;
    h.env.DB = new Proxy(real, {
        get(t, p, r) {
            if (p === 'prepare') return (sql: string) => { db++; return t.prepare(sql); };
            return Reflect.get(t, p, r) as unknown;
        },
    });
    const kv = h.env.TENANT_CACHE as unknown as { get: ReturnType<typeof vi.fn> };
    kv.get.mockClear();
    return { db: () => db, kv: () => kv.get.mock.calls.length };
}

async function post(h: Harness, path: string, body: BodyInit, headers: Record<string, string> = {}): Promise<Response> {
    const exec = makeExecutionContext({ label: 'ingress' });
    const res = await app.request(path, {
        method: 'POST', body, headers: { 'intuit-signature': 'AAAA', 'stripe-signature': 't=1,v1=00', ...headers },
        ...(typeof body === 'object' ? { duplex: 'half' } : {}),
    } as RequestInit, h.env, exec.ctx);
    await exec.settle();
    return res;
}

/** A limiter that allows `limit` calls per key and records every key it saw. */
function fakeLimiter(limit: number) {
    const seen = new Map<string, number>();
    const keys: string[] = [];
    return {
        keys,
        limit: async ({ key }: { key: string }) => {
            keys.push(key);
            const n = (seen.get(key) ?? 0) + 1;
            seen.set(key, n);
            return { success: n <= limit };
        },
    };
}

describe.each([
    ['QuickBooks', QBO_PATH, QBO_MAX],
    ['Stripe', STRIPE_PATH, STRIPE_MAX],
] as const)('%s webhook body cap', (_name, path, max) => {
    let h: Harness;
    afterEach(() => { vi.restoreAllMocks(); h?.close(); });

    // Mutation: remove the guard from the app -> the oversize body reaches the
    // handler (and the tenant lookups) instead of 413.
    it('refuses a body one byte over the cap with 413, before any lookup, and logs it', T, async () => {
        h = await webhookHarness('saas');
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const seen = watchLookups(h);
        const res = await post(h, path, 'a'.repeat(max + 1));
        expect(res.status).toBe(413);
        expect(seen.db()).toBe(0);
        expect(seen.kv()).toBe(0);
        expect(warn.mock.calls.some((c) => String(c[0]).startsWith('Webhook delivery too large'))).toBe(true);
    });

    it('control: a body of exactly the cap gets past the guard', T, async () => {
        h = await webhookHarness('saas');
        const res = await post(h, path, 'a'.repeat(max));
        expect(res.status).not.toBe(413);
    });

    it('enforces the cap while reading when no Content-Length is sent', T, async () => {
        h = await webhookHarness('saas');
        const chunk = new Uint8Array(64 * 1024).fill(97);
        const stream = () => new ReadableStream<Uint8Array>({
            start(controller) {
                for (let sent = 0; sent < max + chunk.length; sent += chunk.length) controller.enqueue(chunk);
                controller.close();
            },
        });
        const seen = watchLookups(h);
        const res = await post(h, path, stream());
        expect(res.status).toBe(413);
        expect(seen.db()).toBe(0);
        expect(seen.kv()).toBe(0);
    });
});

describe('webhook rate limit', () => {
    let h: Harness;
    afterEach(() => { vi.restoreAllMocks(); h?.close(); });
    const bind = (name: string, limiter: ReturnType<typeof fakeLimiter>) =>
        Object.assign(h.env, { [name]: limiter });

    it('QuickBooks: the Nth delivery from one source trips 429 and not before; another source is unaffected', T, async () => {
        h = await webhookHarness('saas');
        const limiter = fakeLimiter(3);
        bind('QBO_WEBHOOK_RATE_LIMITER', limiter);
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const from = (ip: string) => post(h, QBO_PATH, '[]', { 'CF-Connecting-IP': ip });
        expect([(await from('1.1.1.1')).status, (await from('1.1.1.1')).status, (await from('1.1.1.1')).status])
            .toEqual([200, 200, 200]);
        const seen = watchLookups(h);
        expect((await from('1.1.1.1')).status).toBe(429);
        expect(seen.db()).toBe(0);
        expect(seen.kv()).toBe(0);
        expect(warn.mock.calls.some((c) => String(c[0]).startsWith('Webhook delivery rate limited'))).toBe(true);
        expect((await from('2.2.2.2')).status).toBe(200);
    });

    it('Stripe: keyed by company and source, so one company does not spend another company\'s allowance', T, async () => {
        h = await webhookHarness('saas');
        const limiter = fakeLimiter(2);
        bind('STRIPE_WEBHOOK_RATE_LIMITER', limiter);
        const ip = { 'CF-Connecting-IP': '3.3.3.3' };
        expect((await post(h, STRIPE_PATH, '{}', ip)).status).not.toBe(429);
        expect((await post(h, STRIPE_PATH, '{}', ip)).status).not.toBe(429);
        expect((await post(h, STRIPE_PATH, '{}', ip)).status).toBe(429);
        expect((await post(h, '/webhooks/stripe/other-co', '{}', ip)).status).not.toBe(429);
        expect(limiter.keys).toContain(`webhook-stripe:${TENANT_SLUG}:3.3.3.3`);
    });

    it('DISABLE_RATE_LIMIT=1 (the e2e flag) turns the limit off', T, async () => {
        h = await webhookHarness('saas');
        bind('QBO_WEBHOOK_RATE_LIMITER', fakeLimiter(1));
        Object.assign(h.env, { DISABLE_RATE_LIMIT: '1' });
        const statuses = [];
        for (let i = 0; i < 4; i++) statuses.push((await post(h, QBO_PATH, '[]')).status);
        expect(statuses).toEqual([200, 200, 200, 200]);
    });

    it('with no binding configured (local dev, self-host) nothing is limited', T, async () => {
        h = await webhookHarness('standalone');
        for (let i = 0; i < 4; i++) expect((await post(h, QBO_PATH, '[]')).status).toBe(200);
    });
});

/** The real guard in front of a stub handler that answers a chosen status, standing in for "signature verified" (200) or not (403). */
function guardedApp(limit: number) {
    const limiter = fakeLimiter(limit);
    const stub = new Hono<HonoConfig>();
    stub.onError((err, c) => c.json({ error: err.message }, err instanceof AppError ? (err.status as 429) : 500));
    stub.use('/webhooks/*', webhookIngressGuard);
    stub.post('/webhooks/sms/inbound/:slug', (c) => c.body(null, Number(c.req.header('x-answer')) as 200));
    const run = (ip: string, answer: number) => stub.request(`/webhooks/sms/inbound/${TENANT_SLUG}`, {
        method: 'POST', body: 'To=%2B15550001111', headers: { 'CF-Connecting-IP': ip, 'x-answer': String(answer) },
    }, { STRIPE_WEBHOOK_RATE_LIMITER: limiter });
    return { app: run, limiter };
}

describe('SMS and email provider callbacks', () => {
    let h: Harness;
    afterEach(() => { vi.restoreAllMocks(); h?.close(); });

    it.each(PROVIDER_PATHS)('%s refuses a body one byte over the cap with 413, before any lookup; the cap itself passes', T, async (path) => {
        h = await webhookHarness('saas');
        const seen = watchLookups(h);
        expect((await post(h, path, 'a'.repeat(PROVIDER_MAX + 1))).status).toBe(413);
        expect(seen.db()).toBe(0);
        expect(seen.kv()).toBe(0);
        // Control: exactly the cap gets past the guard.
        expect((await post(h, path, 'a'.repeat(PROVIDER_MAX))).status).not.toBe(413);
    });

    it('through the real app and its real error handler: the source that keeps failing verification gets a 429, the first failures keep their 403', T, async () => {
        h = await webhookHarness('saas');
        Object.assign(h.env, { STRIPE_WEBHOOK_RATE_LIMITER: fakeLimiter(1) });
        const from = (ip: string) => post(h, PROVIDER_PATHS[0], 'To=%2B15550001111', { 'CF-Connecting-IP': ip });
        expect((await from('8.8.8.8')).status).toBe(403);
        const refused = await from('8.8.8.8');
        // The refusal is thrown after the downstream handler has answered; the app's own handler turns it into the response.
        expect(refused.status).toBe(429);
        expect(refused.headers.get('content-type') ?? '').toContain('application/json');
        expect((await from('9.9.9.9')).status).toBe(403);
    });

    it('never refuses a delivery that verifies, however many arrive, and counts none of them', async () => {
        const { app: guarded, limiter } = guardedApp(2);
        for (let i = 0; i < 25; i++) expect((await guarded('7.7.7.7', 200)).status).toBe(200);
        expect(limiter.keys).toEqual([]);
    });

    it('counts only deliveries that fail verification, per source address: the Nth failure from one source trips 429, another source is unaffected', async () => {
        const { app: guarded, limiter } = guardedApp(2);
        expect([(await guarded('5.5.5.5', 403)).status, (await guarded('5.5.5.5', 403)).status]).toEqual([403, 403]);
        expect((await guarded('5.5.5.5', 403)).status).toBe(429);
        expect((await guarded('6.6.6.6', 403)).status).toBe(403);
        expect(limiter.keys).toContain('webhook-provider-failed:5.5.5.5');
        // A verified delivery from the source that is over its failure allowance still goes through.
        expect((await guarded('5.5.5.5', 200)).status).toBe(200);
    });
});
