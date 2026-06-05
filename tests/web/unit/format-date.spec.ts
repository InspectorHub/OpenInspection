import { describe, it, expect } from 'vitest';
import { formatInspectionDateTime } from '~/lib/format-date';

describe('formatInspectionDateTime (en-US, C-14 part 1)', () => {
    it('renders month day · time for a datetime ISO', () => {
        expect(formatInspectionDateTime('2026-06-04T09:00:00Z', new Date('2026-06-10T00:00:00Z'), 'UTC'))
            .toBe('Jun 4 · 9:00 AM');
    });
    it('appends the year when it differs from now', () => {
        expect(formatInspectionDateTime('2025-12-31T15:30:00Z', new Date('2026-06-10T00:00:00Z'), 'UTC'))
            .toBe('Dec 31, 2025 · 3:30 PM');
    });
    it('omits the time block for date-only values', () => {
        expect(formatInspectionDateTime('2026-06-04', new Date('2026-06-10T00:00:00Z'), 'UTC')).toBe('Jun 4');
    });
    it('degrades to "no date" on null/garbage', () => {
        expect(formatInspectionDateTime(null, new Date(), 'UTC')).toBe('no date');
        expect(formatInspectionDateTime('not-a-date', new Date(), 'UTC')).toBe('no date');
    });
});
