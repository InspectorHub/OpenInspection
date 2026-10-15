import { describe, it, expect } from 'vitest';
import { assertMoneyWriteAllowed } from '../../../server/lib/auth/money-access';
import { AppError } from '../../../server/lib/errors';

const noFin = { financial: false };
const fin = { financial: true };

describe('assertMoneyWriteAllowed', () => {
    it('rejects a changed price without financial and names the field', () => {
        expect(() => assertMoneyWriteAllowed(noFin, { price: 500 }, { price: 450 })).toThrowError(/price/);
    });
    it('uses the FINANCIAL_REQUIRED code with a 403', () => {
        try {
            assertMoneyWriteAllowed(noFin, { price: 500 }, { price: 450 });
            expect.unreachable();
        } catch (e) {
            expect(e).toBeInstanceOf(AppError);
            expect((e as AppError).status).toBe(403);
            expect((e as AppError).code).toBe('FINANCIAL_REQUIRED');
        }
    });
    it('allows an unchanged resend (settings form forwards the whole form)', () => {
        expect(() => assertMoneyWriteAllowed(noFin, { price: 450, notes: 'x' }, { price: 450 })).not.toThrow();
    });
    it('allows non-money fields', () => {
        expect(() => assertMoneyWriteAllowed(noFin, { propertyAddress: 'a' }, { price: 450 })).not.toThrow();
    });
    it('positive control: financial may change it', () => {
        expect(() => assertMoneyWriteAllowed(fin, { price: 500 }, { price: 450 })).not.toThrow();
    });
    it('create (current=null): any non-null money field is rejected without financial', () => {
        expect(() => assertMoneyWriteAllowed(noFin, { price: 100 }, null)).toThrow();
        expect(() => assertMoneyWriteAllowed(noFin, { price: undefined }, null)).not.toThrow();
    });
    it('rejects depositRequiredCents clearing (null) when it was set', () => {
        expect(() => assertMoneyWriteAllowed(noFin, { depositRequiredCents: null }, { depositRequiredCents: 9000 })).toThrow();
    });
    it('checks nested serviceSelections[].priceOverrideCents', () => {
        expect(() => assertMoneyWriteAllowed(noFin, { serviceSelections: [{ serviceId: 's', priceOverrideCents: 1 }] }, null)).toThrow();
    });
    it('accepts an extra field list for setting-specific money keys', () => {
        expect(() => assertMoneyWriteAllowed(noFin, { lateFee: 5 }, { lateFee: 1 }, ['lateFee'])).toThrowError(/lateFee/);
        expect(() => assertMoneyWriteAllowed(noFin, { lateFee: 1 }, { lateFee: 1 }, ['lateFee'])).not.toThrow();
    });
});
