/**
 * `inspections.date` is a CALENDAR day stored as text. `versionForInspection`
 * takes epoch milliseconds. The step between them chooses a timezone whether
 * anybody decides to or not, and choosing wrong selects a different state form
 * on the cutover day -- silently, because both documents look official.
 */
import { describe, it, expect } from 'vitest';
import { utcMidnightOf, calendarDayOfStoredDate } from '../../../server/lib/statutory/inspection-date';
import { versionForInspection } from '../../../server/lib/statutory/form-registry';
import type { StatutoryFormVersion } from '../../../server/lib/statutory/form-registry';

const FORM = 'fl_oir_b1_1802';
const OLD = 'Rev. 01/12';
const NEW = 'Rev. 04/26';

/** The real Florida cutover: Rev. 04/26 replaced Rev. 01/12 on 2026-04-01. */
const VERSIONS: readonly StatutoryFormVersion[] = [
    {
        formId: FORM, version: OLD,
        effectiveFrom: Date.UTC(2012, 0, 1),
        mandatoryFrom: Date.UTC(2012, 0, 1),
        effectiveUntil: Date.UTC(2026, 3, 1),
        sourceUrl: 'https://example.gov/old.pdf', sourceHash: 'a'.repeat(64),
        publishedBy: 'test', publishedAt: Date.UTC(2012, 0, 1),
        withdrawn: null,
    },
    {
        formId: FORM, version: NEW,
        effectiveFrom: Date.UTC(2026, 3, 1),
        mandatoryFrom: Date.UTC(2026, 3, 1),
        effectiveUntil: null,
        sourceUrl: 'https://example.gov/new.pdf', sourceHash: 'b'.repeat(64),
        publishedBy: 'test', publishedAt: Date.UTC(2026, 3, 1),
        withdrawn: null,
    },
];

describe('utcMidnightOf', () => {
    it('a calendar date becomes UTC midnight of that day, not local midnight', () => {
        expect(utcMidnightOf('2026-04-01')).toBe(Date.UTC(2026, 3, 1));
    });

    it('lands exactly on a UTC midnight, which is what the fidelity gate checks', () => {
        // 86,400,000 divides every UTC midnight. The gate uses that arithmetic
        // to catch a published version whose dates were built in local time.
        expect(utcMidnightOf('2026-04-01') % 86_400_000).toBe(0);
    });

    it('refuses a date that is not a calendar day', () => {
        expect(() => utcMidnightOf('2026-4-1')).toThrow();
        expect(() => utcMidnightOf('')).toThrow();
        expect(() => utcMidnightOf('not-a-date')).toThrow();
    });

    it('refuses a day that does not exist, which `new Date` would silently roll', () => {
        // `new Date('2026-02-30')` does not throw in JS -- it rolls to March 2.
        // A rolled date can cross a cutover, so the parse has to read the parts
        // back rather than trust that it parsed.
        expect(() => utcMidnightOf('2026-02-30')).toThrow();
        expect(() => utcMidnightOf('2026-13-01')).toThrow();
        expect(() => utcMidnightOf('2025-02-29')).toThrow();
    });

    it('accepts a real leap day', () => {
        // POSITIVE CONTROL for the rule above: without this, a parser that
        // rejected every February 29th would pass every assertion here.
        expect(utcMidnightOf('2024-02-29')).toBe(Date.UTC(2024, 1, 29));
    });
});

describe('the cutover day selects the right revision', () => {
    it('picks the OLD revision the day before and the NEW one on the day', () => {
        // The whole subsystem exists to stop this being wrong. Under a local
        // interpretation in a UTC+ zone, '2026-04-01' lands in March and
        // selects the superseded document.
        expect(versionForInspection(FORM, utcMidnightOf('2026-03-31'), VERSIONS)?.version).toBe(OLD);
        expect(versionForInspection(FORM, utcMidnightOf('2026-04-01'), VERSIONS)?.version).toBe(NEW);
    });

    it('the local-midnight reading really would pick the wrong one in a UTC+ zone', () => {
        // Demonstrates the failure rather than asserting it cannot happen: this
        // is the arithmetic a `new Date('2026-04-01')`-in-UTC+8 path produces.
        const localMidnightInUtcPlus8 = Date.UTC(2026, 3, 1) - 8 * 60 * 60 * 1000;
        expect(versionForInspection(FORM, localMidnightInUtcPlus8, VERSIONS)?.version).toBe(OLD);
    });
});

/**
 * The door between the COLUMN and this subsystem.
 *
 * Measured 2026-08-30 on a local database: 12 of 14 `inspections.date` values
 * were a bare calendar day and 2 were full ISO instants. Both are written on
 * purpose -- the new-inspection wizard stores `${date}T${startTime}:00` because
 * `booking.service.ts` reads the time of day back out at `slice(11, 16)` to
 * mark a slot busy -- so this subsystem has to READ both without the strict
 * parsers behind it ever seeing an instant.
 */
describe('calendarDayOfStoredDate', () => {
    it('passes a bare calendar day through unchanged', () => {
        expect(calendarDayOfStoredDate('2026-04-01')).toBe('2026-04-01');
    });

    it('reads the day off the shapes the write side actually stores', () => {
        // The wizard: local wall-clock, no zone (`inspection-create-variants`).
        expect(calendarDayOfStoredDate('2026-04-01T09:00:00')).toBe('2026-04-01');
        // `createdAt.toISOString()`, the fallback in `inspection-core` and the
        // clone and re-inspection paths.
        expect(calendarDayOfStoredDate('2026-04-01T13:38:13.657Z')).toBe('2026-04-01');
        // An offset instant, which nothing writes today and `Date#toISOString`
        // could plausibly be replaced by.
        expect(calendarDayOfStoredDate('2026-04-01T09:00:00+02:00')).toBe('2026-04-01');
        expect(calendarDayOfStoredDate('2026-04-01 09:00')).toBe('2026-04-01');
    });

    it('selects the revision from the DAY, never from the instant', () => {
        // The cost of getting this wrong is the whole reason the module exists:
        // a 9am inspection on the cutover day must select the new revision.
        expect(versionForInspection(
            FORM, utcMidnightOf(calendarDayOfStoredDate('2026-04-01T09:00:00Z')), VERSIONS,
        )?.version).toBe(NEW);
        expect(versionForInspection(
            FORM, utcMidnightOf(calendarDayOfStoredDate('2026-03-31T23:59:59Z')), VERSIONS,
        )?.version).toBe(OLD);
    });

    it('still refuses a day that does not exist, suffix or no suffix', () => {
        // Widening the shape must not widen the day check: a rolled date
        // (2026-02-30 -> March 2nd) crosses a cutover and prints the wrong
        // official document.
        expect(() => calendarDayOfStoredDate('2026-02-30')).toThrow(/not a day that exists/);
        expect(() => calendarDayOfStoredDate('2026-02-30T09:00:00Z'))
            .toThrow(/not a day that exists/);
    });

    it('refuses everything that is not one of those two shapes', () => {
        expect(() => calendarDayOfStoredDate('')).toThrow(/not a stored inspection date/);
        expect(() => calendarDayOfStoredDate('2026-4-1')).toThrow(/not a stored inspection date/);
        expect(() => calendarDayOfStoredDate('04/01/2026')).toThrow(/not a stored inspection date/);
        // NOT a prefix match: a slice would have happily returned '2026-04-01'.
        expect(() => calendarDayOfStoredDate('2026-04-01xyz'))
            .toThrow(/not a stored inspection date/);
    });

    it('NEGATIVE CONTROL — utcMidnightOf itself stays strict', () => {
        // The whole point is that this one door widened and nothing behind it
        // did. An instant reaching `utcMidnightOf` or a form blank is still a
        // refusal, by design.
        expect(() => utcMidnightOf('2026-04-01T09:00:00Z')).toThrow(/not a YYYY-MM-DD/);
    });
});
