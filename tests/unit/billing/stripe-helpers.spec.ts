import { describe, it, expect } from 'vitest';
import {
    buildPaymentIntentParams,
    buildDepositIntentParams,
    extractSettledPayment,
    InvoiceNotPayableError,
    DepositNotPayableError,
} from '../../../server/lib/stripe-helpers';

describe('buildPaymentIntentParams', () => {
    const base = { id: 'inv_1', amountCents: 35000, inspectionId: 'insp_9', status: 'sent' };

    it('maps amountCents to amount and defaults currency to usd', () => {
        const p = buildPaymentIntentParams(base, { tenantId: 't_1' });
        expect(p.amount).toBe(35000);
        expect(p.currency).toBe('usd');
    });

    it('carries kind, invoiceId, tenantId and inspectionId in metadata', () => {
        const p = buildPaymentIntentParams(base, { tenantId: 't_1' });
        expect(p.metadata).toEqual({ kind: 'invoice', invoiceId: 'inv_1', tenantId: 't_1', inspectionId: 'insp_9' });
    });

    it('omits inspectionId from metadata when not linked', () => {
        const p = buildPaymentIntentParams({ ...base, inspectionId: null }, { tenantId: 't_1' });
        expect(p.metadata.inspectionId).toBeUndefined();
        expect(p.metadata.invoiceId).toBe('inv_1');
    });

    it('lowercases an explicit currency', () => {
        const p = buildPaymentIntentParams(base, { tenantId: 't_1', currency: 'CAD' });
        expect(p.currency).toBe('cad');
    });

    it('throws when the invoice is already paid (status)', () => {
        expect(() => buildPaymentIntentParams({ ...base, status: 'paid' }, { tenantId: 't_1' }))
            .toThrow(InvoiceNotPayableError);
    });

    it('throws when the invoice is already paid (paidAt set)', () => {
        expect(() => buildPaymentIntentParams({ ...base, paidAt: '2026-06-01' }, { tenantId: 't_1' }))
            .toThrow(InvoiceNotPayableError);
    });

    it('throws when the amount is zero or negative', () => {
        expect(() => buildPaymentIntentParams({ ...base, amountCents: 0 }, { tenantId: 't_1' }))
            .toThrow(InvoiceNotPayableError);
        expect(() => buildPaymentIntentParams({ ...base, amountCents: -5 }, { tenantId: 't_1' }))
            .toThrow(InvoiceNotPayableError);
    });
});

describe('extractSettledPayment', () => {
    const succeeded = (metadata: Record<string, string> | null) => ({
        type: 'payment_intent.succeeded',
        data: { object: { metadata } },
    });

    it('returns the settled ref for a successful payment intent', () => {
        const out = extractSettledPayment(succeeded({ invoiceId: 'inv_1', tenantId: 't_1', inspectionId: 'insp_9' }));
        expect(out).toMatchObject({
            tenantId: 't_1', inspectionId: 'insp_9',
            purpose: { kind: 'invoice', invoiceId: 'inv_1' },
        });
    });

    it('returns null inspectionId when absent', () => {
        const out = extractSettledPayment(succeeded({ invoiceId: 'inv_1', tenantId: 't_1' }));
        expect(out).toMatchObject({ tenantId: 't_1', inspectionId: null, purpose: { kind: 'invoice', invoiceId: 'inv_1' } });
    });

    // The blocker this whole shape exists to remove. A deposit intent carries no
    // invoiceId — there is no invoice — and under the old rule that made it
    // indistinguishable from a stray event: the handler logged `received`, ACKed,
    // and the money was in Stripe with nothing in the ledger and nothing saying so.
    it('recognises a deposit intent, which carries no invoice at all', () => {
        const out = extractSettledPayment({
            type: 'payment_intent.succeeded',
            data: { object: { id: 'pi_dep', amount_received: 9000, metadata: { kind: 'deposit', inspectionId: 'insp_9', tenantId: 't_1' } } },
        });
        expect(out).toEqual({
            tenantId: 't_1',
            purpose: { kind: 'deposit', inspectionId: 'insp_9' },
            providerRef: 'pi_dep',
            amountCents: 9000,
            inspectionId: 'insp_9',
        });
    });

    it('reads an intent minted before `kind` existed as an invoice payment', () => {
        const out = extractSettledPayment(succeeded({ invoiceId: 'inv_1', tenantId: 't_1' }));
        expect(out?.purpose.kind).toBe('invoice');
    });

    it('records what SETTLED, not what was asked for', () => {
        const out = extractSettledPayment({
            type: 'payment_intent.succeeded',
            data: { object: { id: 'pi_1', amount: 45000, amount_received: 9000, metadata: { kind: 'invoice', invoiceId: 'inv_1', tenantId: 't_1' } } },
        });
        expect(out?.amountCents).toBe(9000);
    });

    it('refuses a kind this build does not know rather than guessing where the money goes', () => {
        expect(extractSettledPayment(succeeded({ kind: 'retainer', tenantId: 't_1', invoiceId: 'inv_1' }))).toBeNull();
    });

    it('refuses a deposit with no inspection to hold it against', () => {
        expect(extractSettledPayment(succeeded({ kind: 'deposit', tenantId: 't_1' }))).toBeNull();
    });

    it('ignores unrelated event types', () => {
        expect(extractSettledPayment({ type: 'payment_intent.created', data: { object: { metadata: { invoiceId: 'x', tenantId: 'y' } } } })).toBeNull();
    });

    it('returns null when required metadata is missing', () => {
        expect(extractSettledPayment(succeeded({ tenantId: 't_1' }))).toBeNull();
        expect(extractSettledPayment(succeeded({ invoiceId: 'inv_1' }))).toBeNull();
        expect(extractSettledPayment(succeeded(null))).toBeNull();
    });
});

describe('buildDepositIntentParams', () => {
    const ctx = { tenantId: 't_1' };

    it('stamps kind + inspectionId, and no invoiceId', () => {
        const params = buildDepositIntentParams({ inspectionId: 'insp_9', outstandingCents: 9000 }, ctx);
        expect(params.amount).toBe(9000);
        expect(params.metadata).toEqual({ kind: 'deposit', inspectionId: 'insp_9', tenantId: 't_1' });
        expect(params.metadata.invoiceId).toBeUndefined();
    });

    it('charges the OUTSTANDING amount, so an abandoned form is not billed twice', () => {
        expect(buildDepositIntentParams({ inspectionId: 'insp_9', outstandingCents: 4000 }, ctx).amount).toBe(4000);
    });

    it('refuses when nothing is outstanding', () => {
        expect(() => buildDepositIntentParams({ inspectionId: 'insp_9', outstandingCents: 0 }, ctx))
            .toThrow(DepositNotPayableError);
        expect(() => buildDepositIntentParams({ inspectionId: 'insp_9', outstandingCents: -1 }, ctx))
            .toThrow(DepositNotPayableError);
    });

    it('lowercases the currency Stripe expects', () => {
        expect(buildDepositIntentParams({ inspectionId: 'i', outstandingCents: 1 }, { ...ctx, currency: 'CAD' }).currency).toBe('cad');
    });
});
