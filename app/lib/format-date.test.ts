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

/**
 * A zone is not optional information.
 *
 * The timezone argument used to be optional, and four of fourteen call sites left
 * it off — two of them on the inspector portal, whose other calls passed it. Omitting
 * it falls through to Intl's default, which is the BROWSER's zone, so one page
 * rendered the same instant twice in two zones: an inspection booked for 09:00
 * read 09:00 in the schedule card and 5:00 PM in the page header for a viewer
 * eight hours off the tenant's zone. Nothing about that is visible in review — both
 * calls look identical apart from a trailing argument.
 *
 * So a caller must now name the zone it means. These cases pin the two things that
 * makes possible: an explicit UTC when that is genuinely the answer, and the
 * rejection of a blank one.
 */
describe('formatInspectionDateTime — the zone must be named', () => {
    const now = new Date('2026-07-15T00:00:00Z');

    it('renders the same instant differently in two zones, which is the whole point', () => {
        const instant = '2026-07-15T09:00:00Z';
        expect(formatInspectionDateTime(instant, now, 'UTC')).toBe('Jul 15 · 9:00 AM UTC');
        expect(formatInspectionDateTime(instant, now, 'Asia/Shanghai')).toBe('Jul 15 · 5:00 PM GMT+8');
    });

    it('treats a blank zone as UTC rather than silently using the viewer\'s', () => {
        // Defence in depth behind the type: a value threaded from config can still
        // arrive empty at runtime, and the browser's zone is never the right guess
        // for a tenant's scheduled time.
        expect(formatInspectionDateTime('2026-07-15T09:00:00Z', now, '')).toBe('Jul 15 · 9:00 AM UTC');
    });
});
