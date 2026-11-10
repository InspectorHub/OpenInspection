import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const verifyWebhook = vi.fn();
vi.mock('../../../server/services/stripe.service', () => ({
    StripeService: class { constructor(_k: string) { void _k; } verifyWebhook = verifyWebhook; },
}));

// The ledger is exercised for real in tests/unit/bookings/deposit-collection.spec.ts.
// Here the question is only whether the handler ROUTES a deposit there at all —
// which it did not before `metadata.kind` existed, and no test noticed.
// `vi.hoisted` because vi.mock factories are lifted above every const in the
// file, and a plain `const` referenced inside one is a TDZ error at import time.
const { recordPayment } = vi.hoisted(() => ({ recordPayment: vi.fn() }));
vi.mock('../../../server/services/payment-ledger.service', () => ({ recordPayment }));
vi.mock('../../../server/lib/route-helpers', () => ({ getDrizzle: () => ({}) }));
const applyHeldDepositsToInvoice = vi.hoisted(() => vi.fn());
vi.mock('../../../server/services/invoice/deposit-application', () => ({ applyHeldDepositsToInvoice }));

import stripeWebhookApi from '../../../server/api/stripe-webhook';
import { makeExecutionContext } from '../helpers/exec-ctx';

/** Settled at teardown by the helper -- `void p` used to detach the promise,
 *  which is how a run with every test passing could still exit non-zero. */
const EXEC_CTX = makeExecutionContext().ctx;

function makeApp(opts: {
    tenantId?: string;
    env?: Record<string, unknown>;
    markPaid?: ReturnType<typeof vi.fn>;
    markPaymentReceived?: ReturnType<typeof vi.fn>;
    findById?: ReturnType<typeof vi.fn>;
    findByInspectionId?: ReturnType<typeof vi.fn>;
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
            invoice: { markPaid: opts.markPaid ?? vi.fn(), findById: opts.findById ?? vi.fn().mockResolvedValue(null), findByInspectionId: opts.findByInspectionId ?? vi.fn().mockResolvedValue(null) },
            inspection: { markPaymentReceived: opts.markPaymentReceived ?? vi.fn() },
        } as never);
        Object.defineProperty(c, 'executionCtx', {
            // From module scope, not built here: this runs per request, so a
            // fresh context each time would register a teardown hook from
            // inside a test and settle nothing. One context, settled once.
            value: EXEC_CTX,
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
beforeEach(() => { verifyWebhook.mockReset(); recordPayment.mockReset(); recordPayment.mockResolvedValue({ id: 'op1' }); });

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

    it('happy path (an event with no amount or intent id falls back to the plain remainder call) → SYNCHRONOUS markPaid with PATH tenant + processed logged', async () => {
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

    it('passes what Stripe actually took, with the intent id, so the ledger records the charge and a redelivery is a no-op', async () => {
        verifyWebhook.mockResolvedValue({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_inv_1', amount_received: 36000, metadata: { invoiceId: 'i1', tenantId: 'tA' } } } });
        const markPaid = vi.fn().mockResolvedValue(undefined);
        const res = await makeApp({ tenantId: 'tA', env: KEYS, markPaid }).request('/', { method: 'POST', headers: SIG, body: '{}' });
        expect(res.status).toBe(200);
        expect(markPaid).toHaveBeenCalledWith('i1', 'tA', 'oi', 'card', { amountCents: 36000, providerRef: 'pi_inv_1' });
    });

    describe('the report gate opens only when the invoice is paid', () => {
        const event = { type: 'payment_intent.succeeded', data: { object: { id: 'pi_inv_1', amount_received: 30000, metadata: { invoiceId: 'i1', tenantId: 'tA', inspectionId: 'insp1' } } } };
        const row = { id: 'p1' };

        it('positive control: the charge settles the invoice in full → gate opens', async () => {
            verifyWebhook.mockResolvedValue(event);
            const markPaymentReceived = vi.fn(); const findById = vi.fn().mockResolvedValue({ paidAt: new Date(), voidedAt: null });
            await makeApp({ tenantId: 'tA', env: KEYS, markPaid: vi.fn().mockResolvedValue(row), markPaymentReceived, findById })
                .request('/', { method: 'POST', headers: SIG, body: '{}' });
            expect(markPaymentReceived).toHaveBeenCalledWith('tA', 'insp1');
        });

        it('the charge is less than the total (total raised after the intent was minted) → invoice stays partial, gate stays shut', async () => {
            verifyWebhook.mockResolvedValue(event);
            const markPaymentReceived = vi.fn(); const findById = vi.fn().mockResolvedValue({ paidAt: null, voidedAt: null });
            const res = await makeApp({ tenantId: 'tA', env: KEYS, markPaid: vi.fn().mockResolvedValue(row), markPaymentReceived, findById })
                .request('/', { method: 'POST', headers: SIG, body: '{}' });
            expect(res.status).toBe(200);
            expect(findById).toHaveBeenCalledWith('tA', 'i1');
            expect(markPaymentReceived).not.toHaveBeenCalled();
        });

        it('a redelivery appends nothing and must not re-open a gate the owner re-locked', async () => {
            verifyWebhook.mockResolvedValue(event);
            const markPaymentReceived = vi.fn(); const findById = vi.fn().mockResolvedValue({ paidAt: new Date(), voidedAt: null });
            await makeApp({ tenantId: 'tA', env: KEYS, markPaid: vi.fn().mockResolvedValue(null), markPaymentReceived, findById })
                .request('/', { method: 'POST', headers: SIG, body: '{}' });
            expect(markPaymentReceived).not.toHaveBeenCalled();
        });

        it('a voided invoice never opens the gate', async () => {
            verifyWebhook.mockResolvedValue(event);
            const markPaymentReceived = vi.fn(); const findById = vi.fn().mockResolvedValue({ paidAt: new Date(), voidedAt: new Date() });
            await makeApp({ tenantId: 'tA', env: KEYS, markPaid: vi.fn().mockResolvedValue(row), markPaymentReceived, findById })
                .request('/', { method: 'POST', headers: SIG, body: '{}' });
            expect(markPaymentReceived).not.toHaveBeenCalled();
        });
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
        const { Errors } = await import('../../../server/lib/errors');
        verifyWebhook.mockResolvedValue({ type: 'payment_intent.succeeded', data: { object: { metadata: { invoiceId: 'gone', tenantId: 'tA' } } } });
        const markPaid = vi.fn().mockRejectedValue(Errors.NotFound('Invoice not found'));
        const res = await makeApp({ tenantId: 'tA', env: KEYS, markPaid }).request('/', { method: 'POST', headers: SIG, body: '{}' });
        expect(res.status).toBe(200);
    });

    /* ---------------------------------------------------------------- *
     *  Booking deposits — money against an ORDER, with no invoice.      *
     * ---------------------------------------------------------------- */

    it('writes a deposit ledger row instead of ACKing it as nothing to do', async () => {
        // The regression: `extractSettledPayment` used to return null for any
        // intent without `metadata.invoiceId`, so a settled deposit logged
        // "received" and vanished. Money in Stripe, no row, no surface.
        verifyWebhook.mockResolvedValue({
            type: 'payment_intent.succeeded',
            data: { object: { id: 'pi_dep_1', amount_received: 9000, metadata: { kind: 'deposit', inspectionId: 'insp1', tenantId: 'tA' } } },
        });
        const markPaid = vi.fn(); const markPaymentReceived = vi.fn(); const kvPut = vi.fn();
        const res = await makeApp({ tenantId: 'tA', env: KEYS, markPaid, markPaymentReceived, kvPut })
            .request('/', { method: 'POST', headers: SIG, body: '{}' });

        expect(res.status).toBe(200);
        expect(recordPayment).toHaveBeenCalledWith({}, 'tA', {
            inspectionId: 'insp1',
            invoiceId:    null,
            kind:         'deposit',
            amountCents:  9000,
            method:       'card',
            provider:     'stripe',
            providerRef:  'pi_dep_1',
        });
        expect(String(kvPut.mock.calls[0][1])).toContain('"processed"');
    });

    describe('a deposit that lands after an invoice exists', () => {
        const dep = { type: 'payment_intent.succeeded', data: { object: { id: 'pi_dep_9', amount_received: 9000, metadata: { kind: 'deposit', inspectionId: 'insp1', tenantId: 'tA' } } } };
        beforeEach(() => { applyHeldDepositsToInvoice.mockReset(); recordPayment.mockReset(); });

        it('is attached to that invoice', async () => {
            verifyWebhook.mockResolvedValue(dep); recordPayment.mockResolvedValue({ id: 'row1' });
            const findByInspectionId = vi.fn().mockResolvedValue({ id: 'inv9', voidedAt: null });
            await makeApp({ tenantId: 'tA', env: KEYS, findByInspectionId }).request('/', { method: 'POST', headers: SIG, body: '{}' });
            expect(applyHeldDepositsToInvoice).toHaveBeenCalledWith({}, 'tA', 'inv9', 'insp1');
        });
        it('positive control: with no invoice nothing is attached (the deposit stays held)', async () => {
            verifyWebhook.mockResolvedValue(dep); recordPayment.mockResolvedValue({ id: 'row1' });
            await makeApp({ tenantId: 'tA', env: KEYS }).request('/', { method: 'POST', headers: SIG, body: '{}' });
            expect(applyHeldDepositsToInvoice).not.toHaveBeenCalled();
        });
        it('is not attached to a voided invoice', async () => {
            verifyWebhook.mockResolvedValue(dep); recordPayment.mockResolvedValue({ id: 'row1' });
            const findByInspectionId = vi.fn().mockResolvedValue({ id: 'inv9', voidedAt: new Date() });
            await makeApp({ tenantId: 'tA', env: KEYS, findByInspectionId }).request('/', { method: 'POST', headers: SIG, body: '{}' });
            expect(applyHeldDepositsToInvoice).not.toHaveBeenCalled();
        });
        it('a redelivery appends nothing and attaches nothing', async () => {
            verifyWebhook.mockResolvedValue(dep); recordPayment.mockResolvedValue(null);
            const findByInspectionId = vi.fn().mockResolvedValue({ id: 'inv9', voidedAt: null });
            await makeApp({ tenantId: 'tA', env: KEYS, findByInspectionId }).request('/', { method: 'POST', headers: SIG, body: '{}' });
            expect(applyHeldDepositsToInvoice).not.toHaveBeenCalled();
        });
    });

    it('a deposit does not mark any invoice paid and does not unlock the report', async () => {
        // $90 of a $450 job is not payment in full, and `markPaymentReceived`
        // is the gate the public report reads. Calling either here would
        // release a report for a fifth of the money.
        verifyWebhook.mockResolvedValue({
            type: 'payment_intent.succeeded',
            data: { object: { id: 'pi_dep_2', amount_received: 9000, metadata: { kind: 'deposit', inspectionId: 'insp1', tenantId: 'tA' } } },
        });
        const markPaid = vi.fn(); const markPaymentReceived = vi.fn();
        await makeApp({ tenantId: 'tA', env: KEYS, markPaid, markPaymentReceived })
            .request('/', { method: 'POST', headers: SIG, body: '{}' });
        expect(markPaid).not.toHaveBeenCalled();
        expect(markPaymentReceived).not.toHaveBeenCalled();
    });

    it('a deposit for another tenant is discarded before any write', async () => {
        verifyWebhook.mockResolvedValue({
            type: 'payment_intent.succeeded',
            data: { object: { id: 'pi_dep_3', amount_received: 9000, metadata: { kind: 'deposit', inspectionId: 'insp1', tenantId: 'tB' } } },
        });
        const kvPut = vi.fn();
        const res = await makeApp({ tenantId: 'tA', env: KEYS, kvPut }).request('/', { method: 'POST', headers: SIG, body: '{}' });
        expect(res.status).toBe(200);
        expect(recordPayment).not.toHaveBeenCalled();
        expect(String(kvPut.mock.calls[0][1])).toContain('tenant_mismatch');
    });

    it('a deposit write failure is a 500, so Stripe retries rather than losing it', async () => {
        verifyWebhook.mockResolvedValue({
            type: 'payment_intent.succeeded',
            data: { object: { id: 'pi_dep_4', amount_received: 9000, metadata: { kind: 'deposit', inspectionId: 'insp1', tenantId: 'tA' } } },
        });
        recordPayment.mockRejectedValue(new Error('D1 down'));
        const kvPut = vi.fn();
        const res = await makeApp({ tenantId: 'tA', env: KEYS, kvPut }).request('/', { method: 'POST', headers: SIG, body: '{}' });
        expect(res.status).toBe(500);
        expect(kvPut.mock.calls.map(c2 => String(c2[1])).some(p => p.includes('"processed"'))).toBe(false);
    });

    it('a redelivered deposit is a no-op, not an error', async () => {
        // recordPayment answers null when the provider ref is already on file.
        verifyWebhook.mockResolvedValue({
            type: 'payment_intent.succeeded',
            data: { object: { id: 'pi_dep_1', amount_received: 9000, metadata: { kind: 'deposit', inspectionId: 'insp1', tenantId: 'tA' } } },
        });
        recordPayment.mockResolvedValue(null);
        const kvPut = vi.fn();
        const res = await makeApp({ tenantId: 'tA', env: KEYS, kvPut }).request('/', { method: 'POST', headers: SIG, body: '{}' });
        expect(res.status).toBe(200);
        expect(String(kvPut.mock.calls[0][1])).toContain('"processed"');
    });
});