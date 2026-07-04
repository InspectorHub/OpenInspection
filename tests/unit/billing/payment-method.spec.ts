import { describe, it, expect } from 'vitest';
import { normalizePaymentMethod, PAYMENT_METHODS } from '../../../server/lib/payment-method';

describe('normalizePaymentMethod', () => {
    it('passes through the canonical methods', () => {
        for (const m of PAYMENT_METHODS) {
            expect(normalizePaymentMethod(m)).toBe(m);
        }
    });

    it('is case-insensitive and trims whitespace', () => {
        expect(normalizePaymentMethod('  Check ')).toBe('check');
        expect(normalizePaymentMethod('CARD')).toBe('card');
    });

    it('maps common aliases', () => {
        expect(normalizePaymentMethod('cheque')).toBe('check');
        expect(normalizePaymentMethod('ach')).toBe('offline');
        expect(normalizePaymentMethod('wire')).toBe('offline');
        expect(normalizePaymentMethod('bank transfer')).toBe('offline');
    });

    it('falls back to "other" for unknown or non-string input', () => {
        expect(normalizePaymentMethod('bitcoin')).toBe('other');
        expect(normalizePaymentMethod('')).toBe('other');
        expect(normalizePaymentMethod(undefined)).toBe('other');
        expect(normalizePaymentMethod(null)).toBe('other');
        expect(normalizePaymentMethod(42)).toBe('other');
    });
});
