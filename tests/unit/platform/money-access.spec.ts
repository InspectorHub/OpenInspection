import { describe, it, expect } from 'vitest';
import { assertMoneyWriteAllowed } from '../../../server/lib/auth/money-access';
import { AppError } from '../../../server/lib/errors';

const noFin = { inspectionFees: false, companyFinance: false };
const fin = { inspectionFees: true, companyFinance: true };

describe('assertMoneyWriteAllowed', () => {
    it('rejects a changed price without a finance capability and names the field', () => {
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
    it('positive control: holding both capabilities may change it', () => {
        expect(() => assertMoneyWriteAllowed(fin, { price: 500 }, { price: 450 })).not.toThrow();
    });
    it('create (current=null): any non-null money field is rejected without a finance capability', () => {
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

const feesOnly = { inspectionFees: true, companyFinance: false };
const financeOnly = { inspectionFees: false, companyFinance: true };
const neither = noFin;

describe('assertMoneyWriteAllowed by bucket', () => {
    it('a price change needs inspectionFees, and names it', () => {
        expect(() => assertMoneyWriteAllowed(neither, { price: 500 }, { price: 450 })).toThrowError(/inspectionFees/);
        expect(() => assertMoneyWriteAllowed(feesOnly, { price: 500 }, { price: 450 })).not.toThrow();
    });
    it('a service catalogue price needs companyFinance, not inspectionFees', () => {
        expect(() => assertMoneyWriteAllowed(feesOnly, { defaultPriceCents: 900 }, { defaultPriceCents: 800 })).toThrowError(/companyFinance/);
        expect(() => assertMoneyWriteAllowed(financeOnly, { defaultPriceCents: 900 }, { defaultPriceCents: 800 })).not.toThrow();
    });
    it('companyFinance alone does not allow a per-inspection price', () => {
        expect(() => assertMoneyWriteAllowed(financeOnly, { price: 500 }, { price: 450 })).toThrowError(/inspectionFees/);
    });
    it('the policies need companyFinance', () => {
        expect(() => assertMoneyWriteAllowed(feesOnly, { depositPolicy: { type: 'percent', percent: 10 } }, null, ['depositPolicy'])).toThrow();
        expect(() => assertMoneyWriteAllowed(financeOnly, { depositPolicy: { type: 'percent', percent: 10 } }, null, ['depositPolicy'])).not.toThrow();
    });
    it('one body touching both buckets is refused for the bucket the caller lacks', () => {
        try {
            assertMoneyWriteAllowed(feesOnly, { price: 500, defaultPriceCents: 900 }, { price: 450, defaultPriceCents: 800 });
            expect.unreachable();
        } catch (e) {
            expect((e as AppError).code).toBe('FINANCIAL_REQUIRED');
            expect((e as AppError).details).toMatchObject({ field: 'defaultPriceCents', capability: 'companyFinance' });
        }
    });
    it('money nested in the body is refused for the bucket of the nested key', () => {
        expect(() => assertMoneyWriteAllowed(financeOnly, { serviceSelections: [{ serviceId: 's', priceOverrideCents: 1 }] }, null)).toThrowError(/inspectionFees/);
        expect(() => assertMoneyWriteAllowed(feesOnly, { serviceSelections: [{ serviceId: 's', priceOverrideCents: 1 }] }, null)).not.toThrow();
    });
});
