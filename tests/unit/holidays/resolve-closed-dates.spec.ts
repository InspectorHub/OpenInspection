import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    resolveCompanyClosedDates,
    getHolidayDataCoverage,
} from '../../../server/lib/holidays/resolve-closed-dates';
import { logger } from '../../../server/lib/logger';

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

    it('covers the last shipped data year', () => {
        const { maxYear } = getHolidayDataCoverage();
        const map = resolveCompanyClosedDates({
            region: 'US',
            customRows: [],
            year: maxYear,
        });
        expect(map.size).toBeGreaterThan(0);
    });
});

describe('getHolidayDataCoverage', () => {
    it('reports the contiguous span of shipped federal data', () => {
        const coverage = getHolidayDataCoverage();
        expect(coverage.minYear).toBe(2026);
        expect(coverage.maxYear).toBeGreaterThanOrEqual(2031);
        expect(coverage.maxYear).toBeGreaterThan(coverage.minYear);
    });
});

describe('resolveCompanyClosedDates coverage guard', () => {
    afterEach(() => vi.restoreAllMocks());

    it('warns and returns no catalog dates past the data cliff', () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const beyond = getHolidayDataCoverage().maxYear + 1;
        const map = resolveCompanyClosedDates({
            region: 'US',
            customRows: [{ date: `${beyond}-07-10`, name: 'Company picnic' }],
            year: beyond,
        });
        // Custom rows still resolve; only the built-in catalog runs dry.
        expect(map.get(`${beyond}-07-10`)).toBe('Company picnic');
        expect(map.has(`${beyond}-07-04`)).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('does not warn for a covered year', () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        resolveCompanyClosedDates({ region: 'US', customRows: [], year: 2026 });
        expect(warn).not.toHaveBeenCalled();
    });

    it('does not warn when the catalog is off', () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const beyond = getHolidayDataCoverage().maxYear + 5;
        resolveCompanyClosedDates({ region: null, customRows: [], year: beyond });
        expect(warn).not.toHaveBeenCalled();
    });
});
