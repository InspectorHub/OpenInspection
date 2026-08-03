/**
 * QuickBooks payment push — two defects, both "the function was written and one
 * line was never connected":
 *
 *   1. `recordPayment` had exactly ONE caller, the manual "mark as paid" route.
 *      A client paying by card settled through Stripe, `markPaid` ran, and
 *      QuickBooks never learned. Every online payment was missing from the
 *      tenant's books.
 *   2. The push carried no idempotency key, and Stripe redelivers webhooks. A
 *      duplicate Payment overstates a tenant's revenue and their tax position.
 *
 * QBO's contract for `requestid` is that a repeated key returns the ORIGINAL
 * response rather than performing the operation again. What we can verify
 * locally is that we send a key derived from the OI record — unique per fact —
 * rather than per attempt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

import { QBOServiceBase } from '../../../server/services/qbo/api-base';
import { withInvoiceSync } from '../../../server/services/qbo/invoice-sync';

const verifyWebhook = vi.fn();
vi.mock('../../../server/services/stripe.service', () => ({
    StripeService: class { constructor(_k: string) { void _k; } verifyWebhook = verifyWebhook; },
}));

import stripeWebhookApi from '../../../server/api/stripe-webhook';

// --- recordPayment: what actually goes on the wire ------------------------

interface Call { method: string; path: string; body: unknown }

/**
 * The invoice→QBO mapping lookup is one `select().from().where().get()`; stub
 * that rather than standing up sqlite, because what this spec is about is the
 * request we build, not the join that finds the id.
 */
function stubDb(qboId: string | null) {
    const chain = {
        select: () => chain,
        from: () => chain,
        where: () => chain,
        get: async () => (qboId == null ? undefined : { qboId }),
    };
    return chain;
}

class ProbeQbo extends withInvoiceSync(QBOServiceBase) {
    calls: Call[] = [];
    constructor(private readonly mappedQboId: string | null = 'QBO-INV-1') {
        super({} as never, 'cid', 'secret', 'whsec', 'jwt');
    }
    protected override getDrizzle() { return stubDb(this.mappedQboId) as never; }
    protected override async getQBOCustomerIdForInvoice(): Promise<string | null> { return 'QBO-CUST-9'; }
    protected override async apiCall<T>(
        _tenantId: string, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown,
    ): Promise<T> {
        this.calls.push({ method, path, body });
        return {} as T;
    }
}

const requestIdOf = (path: string) =>
    new URLSearchParams(path.slice(path.indexOf('?') + 1)).get('requestid');

describe('recordPayment → QuickBooks', () => {
    it('carries a requestid derived from the OI record, not a random uuid', async () => {
        const qbo = new ProbeQbo();
        await qbo.recordPayment('t1', 'inv-abc12345', 450, 'pay-inv-abc12345');

        expect(qbo.calls).toHaveLength(1);
        expect(qbo.calls[0].path.startsWith('payment')).toBe(true);
        expect(requestIdOf(qbo.calls[0].path)).toBe('pay-inv-abc12345');
    });

    it('sends the same key twice for the same fact — QBO collapses the second', async () => {
        const qbo = new ProbeQbo();
        await qbo.recordPayment('t1', 'inv-abc12345', 450, 'pay-inv-abc12345');
        await qbo.recordPayment('t1', 'inv-abc12345', 450, 'pay-inv-abc12345');

        expect(qbo.calls).toHaveLength(2);                                  // both attempted
        expect(new Set(qbo.calls.map((c) => requestIdOf(c.path))).size).toBe(1); // one key
    });

    it('still posts the amount and the invoice link', async () => {
        const qbo = new ProbeQbo();
        await qbo.recordPayment('t1', 'inv-1', 450, 'pay-inv-1');

        const body = qbo.calls[0].body as {
            TotalAmt: number; CustomerRef: { value: string };
            Line: Array<{ Amount: number; LinkedTxn: Array<{ TxnId: string; TxnType: string }> }>;
        };
        expect(body.TotalAmt).toBe(450);
        expect(body.CustomerRef.value).toBe('QBO-CUST-9');
        expect(body.Line[0].LinkedTxn[0]).toEqual({ TxnId: 'QBO-INV-1', TxnType: 'Invoice' });
    });

    it('pushes nothing when the invoice has no QBO mapping', async () => {
        const qbo = new ProbeQbo(null);
        await qbo.recordPayment('t1', 'inv-1', 450, 'pay-inv-1');
        expect(qbo.calls).toHaveLength(0);
    });
});

// --- the Stripe webhook must reach it at all ------------------------------

const SIG = { 'stripe-signature': 't=1,v1=x' };
const KEYS = { STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_WEBHOOK_SECRET: 'whsec_1' };
const SETTLED = {
    type: 'payment_intent.succeeded',
    data: { object: { metadata: { invoiceId: 'inv-1', tenantId: 'tA', inspectionId: 'insp1' } } },
};

function makeApp(opts: {
    env?: Record<string, unknown>;
    recordPayment?: ReturnType<typeof vi.fn>;
    findById?: ReturnType<typeof vi.fn>;
} = {}) {
    const kv = { get: vi.fn().mockResolvedValue(null), put: vi.fn() };
    const settled: Promise<unknown>[] = [];
    const app = new Hono();
    app.use('*', async (c, next) => {
        c.set('tenantId' as never, 'tA' as never);
        (c as { env: Record<string, unknown> }).env = { TENANT_CACHE: kv, ...KEYS, ...(opts.env ?? {}) };
        c.set('services' as never, {
            invoice: {
                markPaid: vi.fn().mockResolvedValue(undefined),
                findById: opts.findById ?? vi.fn().mockResolvedValue({ id: 'inv-1', amountCents: 45000 }),
            },
            inspection: { markPaymentReceived: vi.fn().mockResolvedValue(undefined) },
            qbo: { recordPayment: opts.recordPayment ?? vi.fn().mockResolvedValue(undefined) },
        } as never);
        Object.defineProperty(c, 'executionCtx', {
            value: { waitUntil: (p: Promise<unknown>) => { settled.push(p); } },
            configurable: true,
        });
        await next();
    });
    app.route('/', stripeWebhookApi);
    return { app, settled };
}

beforeEach(() => { verifyWebhook.mockReset(); });

describe('a card payment reaches QuickBooks', () => {
    it('pushes the payment when Stripe settles an invoice', async () => {
        verifyWebhook.mockResolvedValue(SETTLED);
        const recordPayment = vi.fn().mockResolvedValue(undefined);
        const { app, settled } = makeApp({ env: { QBO_CLIENT_ID: 'qbo-client' }, recordPayment });

        const res = await app.request('/', { method: 'POST', headers: SIG, body: '{}' });
        await Promise.all(settled);

        expect(res.status).toBe(200);
        expect(recordPayment).toHaveBeenCalledWith('tA', 'inv-1', 450, 'pay-inv-1');
    });

    it('does not push when QuickBooks is not connected', async () => {
        verifyWebhook.mockResolvedValue(SETTLED);
        const recordPayment = vi.fn();
        const { app, settled } = makeApp({ recordPayment });

        await app.request('/', { method: 'POST', headers: SIG, body: '{}' });
        await Promise.all(settled);

        expect(recordPayment).not.toHaveBeenCalled();
    });

    it('never fails the webhook when QuickBooks is down', async () => {
        // The customer has already paid. A QuickBooks outage returning 500 here
        // would make Stripe redeliver forever against a payment that succeeded.
        verifyWebhook.mockResolvedValue(SETTLED);
        const recordPayment = vi.fn().mockRejectedValue(new Error('QBO 503'));
        const { app, settled } = makeApp({ env: { QBO_CLIENT_ID: 'qbo-client' }, recordPayment });

        const res = await app.request('/', { method: 'POST', headers: SIG, body: '{}' });
        await Promise.allSettled(settled);

        expect(res.status).toBe(200);
    });

    it('pushes nothing when the invoice cannot be read', async () => {
        verifyWebhook.mockResolvedValue(SETTLED);
        const recordPayment = vi.fn();
        const findById = vi.fn().mockResolvedValue(null);
        const { app, settled } = makeApp({ env: { QBO_CLIENT_ID: 'qbo-client' }, recordPayment, findById });

        const res = await app.request('/', { method: 'POST', headers: SIG, body: '{}' });
        await Promise.all(settled);

        expect(res.status).toBe(200);
        expect(recordPayment).not.toHaveBeenCalled();
    });
});
