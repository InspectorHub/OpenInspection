/**
 * A withdrawn revision is not selected, and the one beside it still is.
 *
 * Withdrawal is the only lever this subsystem has for the one fault it cannot
 * take back: a field map that was wrong, applied to an authority's own form,
 * producing an official document that is already in somebody else's hands.
 * Stopping NEW production is all that is left to do, and it has to happen
 * without the revision leaving the catalogue — re-issuing a report produced from
 * it still has to resolve.
 */
import { describe, it, expect } from 'vitest';
import {
    versionForInspection,
    selectableVersions,
    type StatutoryFormVersion,
} from '../../../server/lib/statutory/form-registry';

const base: Omit<StatutoryFormVersion, 'version' | 'withdrawnAt'> = {
    formId: 'tx_trec_rei',
    effectiveFrom: Date.UTC(2025, 0, 1),
    mandatoryFrom: null,
    effectiveUntil: null,
    sourceUrl: 'https://www.trec.texas.gov/x.pdf',
    sourceHash: 'a'.repeat(64),
    publishedBy: 'platform',
    publishedAt: Date.UTC(2025, 0, 1),
};

describe('withdrawn revisions', () => {
    it('is not selected, so nothing new is produced from a map known to be wrong', () => {
        const v = versionForInspection('tx_trec_rei', Date.UTC(2025, 5, 1), [
            { ...base, version: '7-6', withdrawnAt: Date.UTC(2025, 4, 1) },
        ]);
        expect(v).toBeNull();
    });

    it('a live revision beside a withdrawn one is still selected', () => {
        // The positive control. Without it, a filter that rejected EVERYTHING
        // would pass the assertion above just as happily.
        const v = versionForInspection('tx_trec_rei', Date.UTC(2025, 5, 1), [
            { ...base, version: '7-6', withdrawnAt: Date.UTC(2025, 4, 1) },
            { ...base, version: '7-7', withdrawnAt: null },
        ]);
        expect(v?.version).toBe('7-7');
    });

    it('withdrawal is not "the newest wins" — a live OLDER revision still resolves', () => {
        // The second positive control, and it earns its place: the assertion
        // above would also pass if the filter did nothing at all and the
        // selector simply preferred the later `effectiveFrom`. Here the
        // withdrawn revision is the NEWER one, so only a real filter can
        // produce this answer.
        const v = versionForInspection('tx_trec_rei', Date.UTC(2026, 5, 1), [
            { ...base, version: '7-6', withdrawnAt: null },
            {
                ...base,
                version: '7-7',
                effectiveFrom: Date.UTC(2026, 0, 1),
                mandatoryFrom: Date.UTC(2026, 0, 1),
                withdrawnAt: Date.UTC(2026, 4, 1),
            },
        ]);
        expect(v?.version).toBe('7-6');
    });

    it('drops the withdrawn revision from the offered list, not merely from the default', () => {
        // `versionForInspection` is one door; `selectableVersions` is the other,
        // and it is the one an inspector's picker reads. A filter applied only
        // to the default would leave the withdrawn revision one click away.
        const offered = selectableVersions('tx_trec_rei', Date.UTC(2025, 5, 1), [
            { ...base, version: '7-6', withdrawnAt: Date.UTC(2025, 4, 1) },
            { ...base, version: '7-7', withdrawnAt: null },
        ]);
        expect(offered.map((v) => v.version)).toEqual(['7-7']);
    });
});
