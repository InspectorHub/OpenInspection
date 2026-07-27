/**
 * IA-36 ⑤⑥ — tenant report-link TTL policy.
 *
 * The policy is expressed as a DURATION (never / n days|months|years), never as
 * an absolute date, so "expire in the past" cannot be entered (⑦). It is applied
 * when a link is MINTED, never retroactively to links already issued (⑥).
 */
import { describe, it, expect } from 'vitest';
import {
    resolveReportLinkTtl,
    reportLinkExpiresAt,
    REPORT_LINK_TTL_PRESETS,
    type ReportLinkTtl,
} from '../../../server/lib/report-link-ttl';

const JAN_31 = Date.UTC(2026, 0, 31, 12, 0, 0);

describe('resolveReportLinkTtl', () => {
    it('defaults to never when the prefs blob has no policy', () => {
        expect(resolveReportLinkTtl(null)).toBe('never');
        expect(resolveReportLinkTtl(undefined)).toBe('never');
        expect(resolveReportLinkTtl({})).toBe('never');
    });

    it('returns a stored duration policy', () => {
        expect(resolveReportLinkTtl({ reportLinkTtl: { count: 90, unit: 'days' } }))
            .toEqual({ count: 90, unit: 'days' });
    });

    it('falls back to never for a malformed policy rather than guessing a duration', () => {
        expect(resolveReportLinkTtl({ reportLinkTtl: { count: 0, unit: 'days' } })).toBe('never');
        expect(resolveReportLinkTtl({ reportLinkTtl: { count: 5, unit: 'fortnights' } })).toBe('never');
        expect(resolveReportLinkTtl({ reportLinkTtl: 'soon' })).toBe('never');
    });
});

describe('reportLinkExpiresAt', () => {
    it('never → null (no expiry column value at all)', () => {
        expect(reportLinkExpiresAt('never', JAN_31)).toBeNull();
    });

    it('days are exact 24h multiples', () => {
        expect(reportLinkExpiresAt({ count: 90, unit: 'days' }, JAN_31))
            .toBe(JAN_31 + 90 * 86_400_000);
    });

    it('months land on the same day-of-month', () => {
        const at = reportLinkExpiresAt({ count: 12, unit: 'months' }, JAN_31)!;
        expect(new Date(at).toISOString()).toBe('2027-01-31T12:00:00.000Z');
    });

    it('clamps to the last day when the target month is shorter (Jan 31 + 1 month)', () => {
        const at = reportLinkExpiresAt({ count: 1, unit: 'months' }, JAN_31)!;
        expect(new Date(at).toISOString()).toBe('2026-02-28T12:00:00.000Z');
    });

    it('years are 12-month steps', () => {
        const at = reportLinkExpiresAt({ count: 2, unit: 'years' }, JAN_31)!;
        expect(new Date(at).toISOString()).toBe('2028-01-31T12:00:00.000Z');
    });

    it('always lands in the future — a duration policy can never expire on issue', () => {
        for (const preset of REPORT_LINK_TTL_PRESETS) {
            expect(reportLinkExpiresAt(preset as ReportLinkTtl, JAN_31)!).toBeGreaterThan(JAN_31);
        }
    });
});
