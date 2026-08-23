/**
 * Report-view counting becomes a decision the tenant can actually make.
 *
 * The legitimate-interests assessment assigned the interest to the
 * inspection company — a company that could not enable it, could not disable
 * it, and could not see that it was happening. A tenant's legitimate interest
 * may not be a mask for processing they cannot decline. The assessment does not
 * hold until the decline exists.
 *
 * The switch is therefore the FIRST check, before the access-token test. A
 * tenant who has not chosen this should not have the outcome depend on any
 * other signal — the answer is no because they did not ask for it, not because
 * a header happened to look like a prefetch.
 *
 * Default OFF. Production holds zero `report_views` rows, so nothing is lost by
 * starting from the position that has to be defensible.
 */
import { describe, it, expect } from 'vitest';
import { shouldCountReportView } from '../../../server/lib/report-views';

const base = {
    accessTokenId: 'tok',
    renderMode: false,
    ownerPreview: false,
    method: 'GET',
} as const;

describe('report-view counting is a tenant decision', () => {
    it('does not count when the tenant has not enabled it — the default', () => {
        expect(shouldCountReportView({ ...base, countingEnabled: false })).toBe(false);
    });

    it('counts when the tenant enabled it and every other signal allows', () => {
        expect(shouldCountReportView({ ...base, countingEnabled: true })).toBe(true);
    });

    it('an enabled tenant still respects prefetch and render-mode suppression', () => {
        expect(shouldCountReportView({ ...base, countingEnabled: true, purpose: 'prefetch' })).toBe(false);
        expect(shouldCountReportView({ ...base, countingEnabled: true, renderMode: true })).toBe(false);
        expect(shouldCountReportView({ ...base, countingEnabled: true, secPurpose: 'prerender' })).toBe(false);
        expect(shouldCountReportView({ ...base, countingEnabled: true, ownerPreview: true })).toBe(false);
        expect(shouldCountReportView({ ...base, countingEnabled: true, method: 'HEAD' })).toBe(false);
    });

    it('a disabled tenant is refused even when every other signal is perfect', () => {
        // The direction that proves the switch is a switch and not decoration:
        // the ideal request, from a real reader, still does not count.
        expect(shouldCountReportView({ ...base, countingEnabled: false })).toBe(false);
        expect(shouldCountReportView({
            ...base, countingEnabled: false, purpose: '', secPurpose: '',
        })).toBe(false);
    });

    it('the switch is checked FIRST — a disabled tenant with no access token still reads as disabled', () => {
        // Order matters for a reason that is not cosmetic. Both checks return
        // false, so no test comparing booleans can tell them apart; what would
        // differ is any future branch that logs or reports WHY. A tenant who
        // never opted in should never appear in a record as "suppressed because
        // the link had no token".
        expect(shouldCountReportView({
            ...base, accessTokenId: null as unknown as string, countingEnabled: false,
        })).toBe(false);
    });
});
