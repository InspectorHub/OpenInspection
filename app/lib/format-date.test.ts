import { describe, it, expect } from 'vitest';
import { formatInspectionDateTime } from '~/lib/format-date';

/** Today's rendering: US order, 12-hour clock, English. */
const EN_US = { locale: 'en-US' as const };

describe('formatInspectionDateTime (en-US, C-14 part 1)', () => {
    it('renders month day · time with a timezone label for a datetime ISO', () => {
        expect(formatInspectionDateTime('2026-06-04T09:00:00Z', new Date('2026-06-10T00:00:00Z'), 'UTC', EN_US))
            .toBe('Jun 4 · 9:00 AM UTC');
    });
    it('appends the year when it differs from now', () => {
        expect(formatInspectionDateTime('2025-12-31T15:30:00Z', new Date('2026-06-10T00:00:00Z'), 'UTC', EN_US))
            .toBe('Dec 31, 2025 · 3:30 PM UTC');
    });
    it('omits the time block for date-only values (stays UTC, no label)', () => {
        expect(formatInspectionDateTime('2026-06-04', new Date('2026-06-10T00:00:00Z'), 'UTC', EN_US)).toBe('Jun 4');
    });
    it('degrades to "no date" on null/garbage', () => {
        expect(formatInspectionDateTime(null, new Date(), 'UTC', EN_US)).toBe('no date');
        expect(formatInspectionDateTime('not-a-date', new Date(), 'UTC', EN_US)).toBe('no date');
    });
    it('renders an instant in the supplied timezone', () => {
        const now = new Date('2026-07-15T00:00:00Z');
        // 2026-07-15T13:00:00Z is 09:00 EDT in New York
        expect(formatInspectionDateTime('2026-07-15T13:00:00Z', now, 'America/New_York', EN_US)).toContain('9:00');
        // ...and 1:00 PM in UTC
        expect(formatInspectionDateTime('2026-07-15T13:00:00Z', now, 'UTC', EN_US)).toContain('1:00');
    });
    it('date-only stays UTC regardless of the timezone arg', () => {
        const now = new Date('2026-07-15T00:00:00Z');
        expect(formatInspectionDateTime('2026-07-15', now, 'America/New_York', EN_US)).toBe('Jul 15');
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
        expect(formatInspectionDateTime(instant, now, 'UTC', EN_US)).toBe('Jul 15 · 9:00 AM UTC');
        expect(formatInspectionDateTime(instant, now, 'Asia/Shanghai', EN_US)).toBe('Jul 15 · 5:00 PM GMT+8');
    });

    it('treats a blank zone as UTC rather than silently using the viewer\'s', () => {
        // Defence in depth behind the type: a value threaded from config can still
        // arrive empty at runtime, and the browser's zone is never the right guess
        // for a tenant's scheduled time.
        expect(formatInspectionDateTime('2026-07-15T09:00:00Z', now, '', EN_US)).toBe('Jul 15 · 9:00 AM UTC');
    });
});

/**
 * #270 — the locale must reach Intl, and the shape must NOT come from it.
 *
 * The bug this closes: on a tenant set to `es-419`, a datetime rendered
 * `Aug 3 · 7:58 AM EDT` — English month abbreviation and English meridiem on a
 * Spanish page — because this file pinned `locale: 'en-US'` internally. The pin
 * was invisible from every call site.
 */
describe('formatInspectionDateTime — locale and shape are separate axes', () => {
    const now = new Date('2026-09-01T00:00:00Z');
    const instant = '2026-09-11T14:30:00Z';

    it('renders a non-English locale in that language', () => {
        const out = formatInspectionDateTime(instant, now, 'UTC', { locale: 'es-419' });
        // The regression itself: the English abbreviation must be gone.
        expect(out).not.toContain('Sep 11');
        expect(out).not.toMatch(/\bPM\b/);
        // ...and the Spanish month must be there (es-419 abbreviates as "sept").
        expect(out.toLowerCase()).toContain('sept');
    });

    it('keeps the American order under a non-English locale', () => {
        // Intl alone would give `11 sept` for es-419 — order comes from the enum,
        // words come from the locale. That combination is the whole point of a
        // format preference that is not just a locale: there is no locale meaning
        // "Spanish words, American order".
        const us = formatInspectionDateTime(instant, now, 'UTC', { locale: 'es-419', dateFormat: 'us' });
        const eu = formatInspectionDateTime(instant, now, 'UTC', { locale: 'es-419', dateFormat: 'eu' });
        expect(us.toLowerCase()).toMatch(/^sept\.?\s+11\b/);
        expect(eu.toLowerCase()).toMatch(/^11\s+sept\.?\b/);
    });

    it('honours a 24-hour preference', () => {
        const out = formatInspectionDateTime(instant, now, 'UTC', {
            locale: 'en-US', dateFormat: 'us', timeFormat: '24h',
        });
        expect(out).toContain('14:30');
        expect(out).not.toMatch(/PM/i);
    });

    it('honours ISO date order', () => {
        const out = formatInspectionDateTime(instant, now, 'UTC', {
            locale: 'en-US', dateFormat: 'iso', timeFormat: '24h',
        });
        expect(out).toContain('2026-09-11');
    });

    it('honours EU date order', () => {
        const out = formatInspectionDateTime(instant, now, 'UTC', {
            locale: 'en-US', dateFormat: 'eu', timeFormat: '12h',
        });
        expect(out).toBe('11 Sep · 2:30 PM UTC');
    });

    it('renders byte-identically to today under the defaults', () => {
        // The regression guard: every existing caller passes nothing new, and the
        // output must not move. This is what makes the change safe to ship broadly.
        const out = formatInspectionDateTime(instant, now, 'UTC', {
            locale: 'en-US', dateFormat: 'us', timeFormat: '12h',
        });
        expect(out).toBe('Sep 11 · 2:30 PM UTC');
    });

    it('keeps ISO whole in the current year, where the other shapes drop the year', () => {
        // `09-11` is neither ISO nor unambiguous, so the year-eliding rule that
        // makes dashboard rows compact does not apply to this one shape.
        const iso = formatInspectionDateTime(instant, now, 'UTC', { locale: 'en-US', dateFormat: 'iso' });
        expect(iso).toContain('2026-09-11');
        const us = formatInspectionDateTime(instant, now, 'UTC', { locale: 'en-US', dateFormat: 'us' });
        expect(us).not.toContain('2026');
    });
});
