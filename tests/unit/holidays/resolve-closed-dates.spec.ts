import { describe, it, expect } from 'vitest';
import { resolveCompanyClosedDates } from '../../../server/lib/holidays/resolve-closed-dates';

describe('resolveCompanyClosedDates', () => {
    it('returns empty when region is null', () => {
        const map = resolveCompanyClosedDates({
            region: null,
            customRows: [{ date: '2026-11-26', name: 'Picnic' }],
            year: 2026,
        });
        expect(map.size).toBe(0);
    });

    it('US includes federal Thanksgiving 2026', () => {
        const map = resolveCompanyClosedDates({
            region: 'US',
            customRows: [],
            year: 2026,
        });
        expect(map.get('2026-11-26')).toBe('Thanksgiving Day');
        expect(map.has('2026-03-02')).toBe(false);
    });

    it('US-TX includes federal and Texas dates', () => {
        const map = resolveCompanyClosedDates({
            region: 'US-TX',
            customRows: [],
            year: 2026,
        });
        expect(map.get('2026-11-26')).toBe('Thanksgiving Day');
        expect(map.get('2026-03-02')).toBe('Texas Independence Day');
        expect(map.get('2026-07-03')).toBe('Independence Day');
    });

    it('merges custom holidays when region is set', () => {
        const map = resolveCompanyClosedDates({
            region: 'US',
            customRows: [{ date: '2026-07-10', name: 'Company picnic' }],
            year: 2026,
        });
        expect(map.get('2026-07-10')).toBe('Company picnic');
    });

    it('custom name overrides federal on the same date', () => {
        const map = resolveCompanyClosedDates({
            region: 'US',
            customRows: [{ date: '2026-11-26', name: 'Office closed early' }],
            year: 2026,
        });
        expect(map.get('2026-11-26')).toBe('Office closed early');
    });
});
