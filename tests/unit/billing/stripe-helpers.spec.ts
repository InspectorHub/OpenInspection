import { describe, it, expect } from 'vitest';
import {
    buildPaymentIntentParams,
    extractSettledPayment,
    InvoiceNotPayableError,
} from '../../../server/lib/stripe-helpers';

describe('buildPaymentIntentParams', () => {
    const base = { id: 'inv_1', amountCents: 35000, inspectionId: 'insp_9', status: 'sent' };

    it('maps amountCents to amount and defaults currency to usd', () => {
        const p = buildPaymentIntentParams(base, { tenantId: 't_1' });
        expect(p.amount).toBe(35000);
        expect(p.currency).toBe('usd');
    });

    it('carries invoiceId, tenantId and inspectionId in metadata', () => {
        const p = buildPaymentIntentParams(base, { tenantId: 't_1' });
        expect(p.metadata).toEqual({ invoiceId: 'inv_1', tenantId: 't_1', inspectionId: 'insp_9' });
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
        expect(out).toEqual({ invoiceId: 'inv_1', tenantId: 't_1', inspectionId: 'insp_9' });
    });

    it('returns null inspectionId when absent', () => {
        const out = extractSettledPayment(succeeded({ invoiceId: 'inv_1', tenantId: 't_1' }));
        expect(out).toEqual({ invoiceId: 'inv_1', tenantId: 't_1', inspectionId: null });
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
