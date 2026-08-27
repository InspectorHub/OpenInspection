/**
 * `inspections.date` is a CALENDAR day stored as text. `versionForInspection`
 * takes epoch milliseconds. The step between them chooses a timezone whether
 * anybody decides to or not, and choosing wrong selects a different state form
 * on the cutover day -- silently, because both documents look official.
 */
import { describe, it, expect } from 'vitest';
import { utcMidnightOf } from '../../../server/lib/statutory/inspection-date';
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
    },
    {
        formId: FORM, version: NEW,
        effectiveFrom: Date.UTC(2026, 3, 1),
        mandatoryFrom: Date.UTC(2026, 3, 1),
        effectiveUntil: null,
        sourceUrl: 'https://example.gov/new.pdf', sourceHash: 'b'.repeat(64),
        publishedBy: 'test', publishedAt: Date.UTC(2026, 3, 1),
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
