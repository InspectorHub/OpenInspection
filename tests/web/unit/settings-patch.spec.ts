import { describe, it, expect } from 'vitest';
import { sanitizeSettingsPatch } from '~/lib/settings-patch';

describe('sanitizeSettingsPatch', () => {
    it('drops empty-string fields entirely', () => {
        expect(sanitizeSettingsPatch({ date: '', inspectorId: '', closingDate: '', templateId: 'tpl-1' }))
            .toEqual({ templateId: 'tpl-1' });
    });
    it('expands a date-only value to an ISO datetime', () => {
        const out = sanitizeSettingsPatch({ date: '2026-06-10' });
        expect(out.date).toMatch(/^2026-06-(09|10)T\d{2}:\d{2}:00\.000Z$/); // local 9AM → UTC may shift a day
    });
    it('passes through an already-ISO datetime', () => {
        expect(sanitizeSettingsPatch({ date: '2026-06-10T14:00:00.000Z' }).date).toBe('2026-06-10T14:00:00.000Z');
    });
    it('coerces numeric price and drops NaN', () => {
        expect(sanitizeSettingsPatch({ price: '450' }).price).toBe(450);
        expect(sanitizeSettingsPatch({ price: 'abc' })).toEqual({});
    });
    it('passes booleans through', () => {
        expect(sanitizeSettingsPatch({ paymentRequired: true, agreementRequired: false }))
            .toEqual({ paymentRequired: true, agreementRequired: false });
    });
});
