import { describe, it, expect } from 'vitest';
import {
    getHolidayInternalEffect,
    getHolidayPublicEffect,
} from '../../../server/lib/holidays/apply-holiday-policy';

const catalogWithThanksgiving = new Map([['2026-11-26', 'Thanksgiving Day']]);

describe('apply-holiday-policy', () => {
    it('public block returns block effect when date in catalog', () => {
        expect(getHolidayPublicEffect(
            { holidayRegion: 'US', holidayPublicPolicy: 'block', holidayInternalPolicy: 'advisory' },
            '2026-11-26',
            catalogWithThanksgiving,
        )).toBe('block');
    });

    it('public advisory returns advisory when date in catalog', () => {
        expect(getHolidayPublicEffect(
            { holidayRegion: 'US', holidayPublicPolicy: 'advisory', holidayInternalPolicy: 'advisory' },
            '2026-11-26',
            catalogWithThanksgiving,
        )).toBe('advisory');
    });

    it('public open ignores catalog', () => {
        expect(getHolidayPublicEffect(
            { holidayRegion: 'US', holidayPublicPolicy: 'open', holidayInternalPolicy: 'advisory' },
            '2026-11-26',
            catalogWithThanksgiving,
        )).toBe('none');
    });

    it('null region is always none', () => {
        expect(getHolidayPublicEffect(
            { holidayRegion: null, holidayPublicPolicy: 'block', holidayInternalPolicy: 'block' },
            '2026-11-26',
            catalogWithThanksgiving,
        )).toBe('none');
    });

    it('date not in catalog is none', () => {
        expect(getHolidayPublicEffect(
            { holidayRegion: 'US', holidayPublicPolicy: 'block', holidayInternalPolicy: 'advisory' },
            '2026-11-25',
            catalogWithThanksgiving,
        )).toBe('none');
    });

    it('internal block returns block when date in catalog', () => {
        expect(getHolidayInternalEffect(
            { holidayRegion: 'US', holidayPublicPolicy: 'open', holidayInternalPolicy: 'block' },
            '2026-11-26',
            catalogWithThanksgiving,
        )).toBe('block');
    });

    it('internal advisory returns advisory when date in catalog', () => {
        expect(getHolidayInternalEffect(
            { holidayRegion: 'US', holidayPublicPolicy: 'open', holidayInternalPolicy: 'advisory' },
            '2026-11-26',
            catalogWithThanksgiving,
        )).toBe('advisory');
    });
});
