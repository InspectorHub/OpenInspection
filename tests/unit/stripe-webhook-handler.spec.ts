import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const verifyWebhook = vi.fn();
vi.mock('../../server/services/stripe.service', () => ({
    StripeService: class { constructor(_k: string) { void _k; } verifyWebhook = verifyWebhook; },
}));

import stripeWebhookApi from '../../server/api/stripe-webhook';

function makeApp(opts: {
    tenantId?: string;
    env?: Record<string, unknown>;
    markPaid?: ReturnType<typeof vi.fn>;
    markPaymentReceived?: ReturnType<typeof vi.fn>;
    kvPut?: ReturnType<typeof vi.fn>;
}) {
    const kv = { get: vi.fn().mockResolvedValue(null), put: opts.kvPut ?? vi.fn() };
    const app = new Hono();
    app.use('*', async (c, next) => {
        if (opts.tenantId) c.set('tenantId' as never, opts.tenantId as never);
        Object.assign(c.env ?? {}, {});
        // Replace env wholesale (Hono allows reading c.env in handlers).
        (c as { env: Record<string, unknown> }).env = { TENANT_CACHE: kv, ...(opts.env ?? {}) };
        c.set('services' as never, {
            invoice: { markPaid: opts.markPaid ?? vi.fn() },
            inspection: { markPaymentReceived: opts.markPaymentReceived ?? vi.fn() },
        } as never);
        Object.defineProperty(c, 'executionCtx', {
            value: { waitUntil: (p: Promise<unknown>) => { void p; } },
            configurable: true,
        });
        await next();
    });
    app.route('/', stripeWebhookApi);
    return app;
}

const SIG = { 'stripe-signature': 't=1,v1=x' };
const KEYS = { STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_WEBHOOK_SECRET: 'whsec_1' };

// Block body so the callback returns undefined: a bare `() => mock.mockReset()`
// implicitly returns the mock, which Vitest 4 then surfaces a later thrown/
// rejected result from as a spurious test error even when the handler catches
// it. Returning undefined avoids that false failure; semantics are unchanged.
beforeEach(() => { verifyWebhook.mockReset(); });

describe('stripe webhook handler', () => {
    it('no tenant / no keys → 200 ACK no-op', async () => {
        const res = await makeApp({}).request('/', { method: 'POST', headers: SIG, body: '{}' });
        expect(res.status).toBe(200);
        expect(verifyWebhook).not.toHaveBeenCalled();
    });

    it('bad signature → 400 + signature_failed logged', async () => {
        verifyWebhook.mockRejectedValue(new Error('bad sig'));
        const kvPut = vi.fn();
        const res = await makeApp({ tenantId: 'tA', env: KEYS, kvPut }).request('/', { method: 'POST', headers: SIG, body: '{}' });
        expect(res.status).toBe(400);
        expect(String(kvPut.mock.calls[0][1])).toContain('signature_failed');
    });

    it('verified non-actionable event → 200 + received logged + no DB write', async () => {
        verifyWebhook.mockResolvedValue({ type: 'payment_intent.created', data: { object: {} } });
        const markPaid = vi.fn(); const kvPut = vi.fn();
        const res = await makeApp({ tenantId: 'tA', env: KEYS, markPaid, kvPut }).request('/', { method: 'POST', headers: SIG, body: '{}' });
        expect(res.status).toBe(200);
        expect(markPaid).not.toHaveBeenCalled();
        expect(String(kvPut.mock.calls[0][1])).toContain('"received"');
    });

    it('metadata tenant ≠ path tenant → 200 ACK-discard + tenant_mismatch + no DB write', async () => {
        verifyWebhook.mockResolvedValue({ type: 'payment_intent.succeeded', data: { object: { metadata: { invoiceId: 'i1', tenantId: 'tB' } } } });
        const markPaid = vi.fn(); const kvPut = vi.fn();
        const res = await makeApp({ tenantId: 'tA', env: KEYS, markPaid, kvPut }).request('/', { method: 'POST', headers: SIG, body: '{}' });
        expect(res.status).toBe(200);
        expect(markPaid).not.toHaveBeenCalled();
        expect(String(kvPut.mock.calls[0][1])).toContain('tenant_mismatch');
    });

    it('happy path → SYNCHRONOUS markPaid with PATH tenant + processed logged', async () => {
        verifyWebhook.mockResolvedValue({ type: 'payment_intent.succeeded', data: { object: { metadata: { invoiceId: 'i1', tenantId: 'tA', inspectionId: 'insp1' } } } });
        const markPaid = vi.fn().mockResolvedValue(undefined);
        const markPaymentReceived = vi.fn().mockResolvedValue(undefined);
        const kvPut = vi.fn();
        const res = await makeApp({ tenantId: 'tA', env: KEYS, markPaid, markPaymentReceived, kvPut }).request('/', { method: 'POST', headers: SIG, body: '{}' });
        expect(res.status).toBe(200);
        expect(markPaid).toHaveBeenCalledWith('i1', 'tA', 'oi', 'card');
        expect(markPaymentReceived).toHaveBeenCalledWith('tA', 'insp1');
        expect(String(kvPut.mock.calls[0][1])).toContain('"processed"');
    });

    it('DB failure → 500 (Stripe retries) and no processed entry', async () => {
        verifyWebhook.mockResolvedValue({ type: 'payment_intent.succeeded', data: { object: { metadata: { invoiceId: 'i1', tenantId: 'tA' } } } });
        const markPaid = vi.fn().mockRejectedValue(new Error('D1 down'));
        const kvPut = vi.fn();
        const res = await makeApp({ tenantId: 'tA', env: KEYS, markPaid, kvPut }).request('/', { method: 'POST', headers: SIG, body: '{}' });
        expect(res.status).toBe(500);
        const puts = kvPut.mock.calls.map(c2 => String(c2[1]));
        expect(puts.some(p => p.includes('"processed"'))).toBe(false);
    });

    it('invoice NotFound → 200 ACK (retry can never succeed)', async () => {
        const { Errors } = await import('../../server/lib/errors');
        verifyWebhook.mockResolvedValue({ type: 'payment_intent.succeeded', data: { object: { metadata: { invoiceId: 'gone', tenantId: 'tA' } } } });
        const markPaid = vi.fn().mockRejectedValue(Errors.NotFound('Invoice not found'));
        const res = await makeApp({ tenantId: 'tA', env: KEYS, markPaid }).request('/', { method: 'POST', headers: SIG, body: '{}' });
        expect(res.status).toBe(200);
    });
});
