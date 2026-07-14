import { describe, it, expect } from 'vitest';
import { formatInspectionDateTime } from '~/lib/format-date';

describe('formatInspectionDateTime (en-US, C-14 part 1)', () => {
    it('renders month day · time with a timezone label for a datetime ISO', () => {
        expect(formatInspectionDateTime('2026-06-04T09:00:00Z', new Date('2026-06-10T00:00:00Z'), 'UTC'))
            .toBe('Jun 4 · 9:00 AM UTC');
    });
    it('appends the year when it differs from now', () => {
        expect(formatInspectionDateTime('2025-12-31T15:30:00Z', new Date('2026-06-10T00:00:00Z'), 'UTC'))
            .toBe('Dec 31, 2025 · 3:30 PM UTC');
    });
    it('omits the time block for date-only values (stays UTC, no label)', () => {
        expect(formatInspectionDateTime('2026-06-04', new Date('2026-06-10T00:00:00Z'), 'UTC')).toBe('Jun 4');
    });
    it('degrades to "no date" on null/garbage', () => {
        expect(formatInspectionDateTime(null, new Date(), 'UTC')).toBe('no date');
        expect(formatInspectionDateTime('not-a-date', new Date(), 'UTC')).toBe('no date');
    });
    it('renders an instant in the supplied timezone', () => {
        const now = new Date('2026-07-15T00:00:00Z');
        // 2026-07-15T13:00:00Z is 09:00 EDT in New York
        expect(formatInspectionDateTime('2026-07-15T13:00:00Z', now, 'America/New_York')).toContain('9:00');
        // ...and 1:00 PM in UTC
        expect(formatInspectionDateTime('2026-07-15T13:00:00Z', now, 'UTC')).toContain('1:00');
    });
    it('date-only stays UTC regardless of the timezone arg', () => {
        const now = new Date('2026-07-15T00:00:00Z');
        expect(formatInspectionDateTime('2026-07-15', now, 'America/New_York')).toBe('Jul 15');
    });
});
