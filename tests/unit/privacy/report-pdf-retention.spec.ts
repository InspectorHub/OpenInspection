/**
 * How long a rendered report PDF is kept, and who chose the number.
 *
 * The number survived a review review; its old reasoning did not. The
 * "5 + 2 = 7" derivation this repository used to carry was put to review and
 * REJECTED (review, decision): Illinois is five years OR two years past
 * final disposition of a qualifying proceeding, WHICHEVER IS LONGER, so the
 * second figure is an event-dependent tail rather than a fixed cap, and a
 * proceeding ending in year six pushes the statutory period past seven. Seven
 * years therefore cannot be presented as "the longest statutory period".
 *
 * What that means for code, and why it is tested rather than commented: the
 * default has to be machine-readably marked as a platform choice, so a later
 * reader — or a settings screen, or an export of the retention register —
 * cannot restate it as a legal requirement.
 */
import { describe, it, expect } from 'vitest';
import {
    REPORT_PDF_RETENTION_DEFAULT_YEARS,
    REPORT_PDF_RETENTION_BASIS,
    resolveReportPdfRetentionYears,
} from '../../../server/lib/compliance/report-pdf-retention';

describe('report-PDF retention resolution', () => {
    it('an unset config gets the disclosed platform default of seven years', () => {
        expect(resolveReportPdfRetentionYears(null)).toBe(7);
        expect(resolveReportPdfRetentionYears(undefined)).toBe(7);
        expect(resolveReportPdfRetentionYears({})).toBe(7);
        expect(REPORT_PDF_RETENTION_DEFAULT_YEARS).toBe(7);
    });

    it('an explicit tenant choice always wins over the default', () => {
        expect(resolveReportPdfRetentionYears({ reportPdfRetentionYears: 3 })).toBe(3);
        expect(resolveReportPdfRetentionYears({ reportPdfRetentionYears: 25 })).toBe(25);
    });

    it('zero means indefinite — a controller instruction the platform executes', () => {
        expect(resolveReportPdfRetentionYears({ reportPdfRetentionYears: 0 })).toBe(0);
    });

    it('a value that is not a whole non-negative number falls back rather than being trusted', () => {
        // A NULL column on an old row, or a string that survived a JSON round
        // trip, must not become a retention window. Falling back to the
        // disclosed default is the only safe direction: the alternative is a
        // sweep computing a cutoff from NaN and deleting everything or nothing.
        for (const bad of [null, undefined, -1, 1.5, NaN, '7' as unknown as number]) {
            expect(resolveReportPdfRetentionYears({ reportPdfRetentionYears: bad as number })).toBe(7);
        }
    });
});

describe('the basis is data, not prose', () => {
    it('records that seven years is a platform choice and NOT a statutory requirement', () => {
        // The taxonomy exists so this survives being read by something that
        // does not read English. A register row saying `P7Y — legal basis =
        // Illinois law` invites the next reader to conclude a California tenant
        // is legally required to keep seven years.
        expect(REPORT_PDF_RETENTION_BASIS.statutoryRequirement).toBe(false);
        expect(REPORT_PDF_RETENTION_BASIS.authorityType).toBe('risk_based_platform_default');
        expect(REPORT_PDF_RETENTION_BASIS.primaryReason).toBe('legal_claim_defence');
        expect(REPORT_PDF_RETENTION_BASIS.secondaryReason).toBe('regulatory_record_retention');
    });

    it('carries review\'s wording verbatim, including the disclaimer sentence', () => {
        // Supplied by review and not to be paraphrased. The assertion is on
        // the two clauses a paraphrase would lose first.
        expect(REPORT_PDF_RETENTION_BASIS.disclosure).toContain(
            'not a statutory retention period and not a representation that seven years is the maximum legally required period',
        );
        expect(REPORT_PDF_RETENTION_BASIS.disclosure).toContain(
            'Tenant-selected retention remains controlling where legally permissible',
        );
    });

    it('every jurisdiction fact carries an as-of date', () => {
        // Washington completed a home-inspector rules revision in July 2026. A
        // citation with no as-of date cannot be known to be stale, so the
        // structure refuses to hold one (review, second constraint).
        expect(REPORT_PDF_RETENTION_BASIS.jurisdictionFacts.length).toBeGreaterThan(0);
        for (const f of REPORT_PDF_RETENTION_BASIS.jurisdictionFacts) {
            expect(f.checkedOn, `${f.jurisdiction} has no as-of date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(f.citation.length).toBeGreaterThan(0);
        }
    });

    it('does not claim seven years is the longest statutory period anywhere', () => {
        // The exact sentence review struck. Asserting its absence is cheap and
        // it is the one that would come back if someone rewrote the prose from
        // memory.
        expect(REPORT_PDF_RETENTION_BASIS.disclosure).not.toMatch(/longest statutory/i);
    });
});
