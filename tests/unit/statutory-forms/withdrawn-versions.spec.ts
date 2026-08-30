/**
 * A withdrawn revision is not selected, the one beside it still is, and the
 * catalogue can still say WHY it was withdrawn.
 *
 * Withdrawal is the only lever this subsystem has for the one fault it cannot
 * take back: a field map that was wrong, applied to an authority's own form,
 * producing an official document that is already in somebody else's hands.
 * Stopping NEW production is all that is left to do, and it has to happen
 * without the revision leaving the catalogue — re-issuing a report produced from
 * it still has to resolve.
 *
 * ── AND THE REASON IS HALF THE FACT ─────────────────────────────────────────
 * The second half of this file is about `withdrawnVersionsFor`, which exists
 * because "no revision covers that date" and "the revision that covers that
 * date was withdrawn" leave `versionForInspection` by the same `null` exit.
 * They are not the same sentence to read: one means this deployment publishes
 * nothing for that day, the other means it published something and took it out
 * of service — and whether the reader waits for us or goes and gets another
 * form depends on which of the two reasons it was.
 */
import { describe, it, expect } from 'vitest';
import {
    versionForInspection,
    selectableVersions,
    withdrawnVersionsFor,
    type StatutoryFormVersion,
    type WithdrawalReason,
} from '../../../server/lib/statutory/form-registry';

const base: Omit<StatutoryFormVersion, 'version' | 'withdrawn'> = {
    formId: 'tx_trec_rei',
    effectiveFrom: Date.UTC(2025, 0, 1),
    mandatoryFrom: null,
    effectiveUntil: null,
    sourceUrl: 'https://www.trec.texas.gov/x.pdf',
    sourceHash: 'a'.repeat(64),
    publishedBy: 'platform',
    publishedAt: Date.UTC(2025, 0, 1),
};

/** A withdrawal, spelled the one way the type allows: date and reason together. */
const because = (reason: WithdrawalReason, at: number) => ({ at, reason });

describe('withdrawn revisions', () => {
    it('is not selected, so nothing new is produced from a map known to be wrong', () => {
        const v = versionForInspection('tx_trec_rei', Date.UTC(2025, 5, 1), [
            { ...base, version: '7-6', withdrawn: because('field_map_incorrect', Date.UTC(2025, 4, 1)) },
        ]);
        expect(v).toBeNull();
    });

    it('a live revision beside a withdrawn one is still selected', () => {
        // The positive control. Without it, a filter that rejected EVERYTHING
        // would pass the assertion above just as happily.
        const v = versionForInspection('tx_trec_rei', Date.UTC(2025, 5, 1), [
            { ...base, version: '7-6', withdrawn: because('field_map_incorrect', Date.UTC(2025, 4, 1)) },
            { ...base, version: '7-7', withdrawn: null },
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
            { ...base, version: '7-6', withdrawn: null },
            {
                ...base,
                version: '7-7',
                effectiveFrom: Date.UTC(2026, 0, 1),
                mandatoryFrom: Date.UTC(2026, 0, 1),
                withdrawn: because('authority_withdrew', Date.UTC(2026, 4, 1)),
            },
        ]);
        expect(v?.version).toBe('7-6');
    });

    it('drops the withdrawn revision from the offered list, not merely from the default', () => {
        // `versionForInspection` is one door; `selectableVersions` is the other,
        // and it is the one an inspector's picker reads. A filter applied only
        // to the default would leave the withdrawn revision one click away.
        const offered = selectableVersions('tx_trec_rei', Date.UTC(2025, 5, 1), [
            { ...base, version: '7-6', withdrawn: because('authority_withdrew', Date.UTC(2025, 4, 1)) },
            { ...base, version: '7-7', withdrawn: null },
        ]);
        expect(offered.map((v) => v.version)).toEqual(['7-7']);
    });

    it('the reason survives selection being refused — it is readable afterwards', () => {
        // The whole point of §5.3: the filter above hides the revision, and the
        // refusal still has to say which of the two faults it was. Asserted
        // against the value the catalogue carries rather than against a literal
        // typed here, so a lookup that returned some OTHER withdrawn revision
        // could not pass by coincidence.
        const catalogue: StatutoryFormVersion[] = [
            { ...base, version: '7-6', withdrawn: because('field_map_incorrect', Date.UTC(2025, 4, 1)) },
        ];
        const found = withdrawnVersionsFor('tx_trec_rei', Date.UTC(2025, 5, 1), catalogue);
        expect(found).toHaveLength(1);
        expect(found[0]).toBe(catalogue[0]);
        expect(found[0]?.withdrawn).toEqual(catalogue[0]?.withdrawn);
    });

    it('the two reasons are told apart, not merely reported as "withdrawn"', () => {
        // The control that matters for §5.3. A lookup that returned the first
        // withdrawn revision it saw, or that collapsed the reason to a boolean,
        // would pass an assertion about ONE reason; it cannot pass one that
        // reads both back distinctly from the same catalogue.
        const ours: StatutoryFormVersion = {
            ...base, formId: 'a_form', version: 'A',
            withdrawn: because('field_map_incorrect', Date.UTC(2025, 4, 1)),
        };
        const theirs: StatutoryFormVersion = {
            ...base, formId: 'b_form', version: 'B',
            withdrawn: because('authority_withdrew', Date.UTC(2025, 4, 1)),
        };
        const catalogue = [ours, theirs];
        const at = Date.UTC(2025, 5, 1);
        expect(withdrawnVersionsFor('a_form', at, catalogue)[0]?.withdrawn?.reason)
            .toBe(ours.withdrawn?.reason);
        expect(withdrawnVersionsFor('b_form', at, catalogue)[0]?.withdrawn?.reason)
            .toBe(theirs.withdrawn?.reason);
        // And they really are different values, so the two assertions above are
        // not one assertion written twice.
        expect(ours.withdrawn?.reason).not.toBe(theirs.withdrawn?.reason);
    });

    it('a LIVE revision is never reported as withdrawn', () => {
        // The positive control for the lookup: a function that returned every
        // revision covering the date would satisfy every assertion above.
        expect(withdrawnVersionsFor('tx_trec_rei', Date.UTC(2025, 5, 1), [
            { ...base, version: '7-6', withdrawn: null },
        ])).toEqual([]);
    });

    it('a withdrawn revision OUTSIDE the date window is not reported either', () => {
        // Withdrawal does not widen the date window. A revision that never
        // covered this inspection is not the explanation for anything, and
        // naming it would send a reader after the wrong document.
        expect(withdrawnVersionsFor('tx_trec_rei', Date.UTC(2024, 5, 1), [
            { ...base, version: '7-6', withdrawn: because('authority_withdrew', Date.UTC(2025, 4, 1)) },
        ])).toEqual([]);
    });

    it('reports the most recent withdrawal first', () => {
        const older: StatutoryFormVersion = {
            ...base, version: '7-5',
            withdrawn: because('authority_withdrew', Date.UTC(2025, 2, 1)),
        };
        const newer: StatutoryFormVersion = {
            ...base, version: '7-6',
            withdrawn: because('field_map_incorrect', Date.UTC(2025, 4, 1)),
        };
        // Supplied oldest-first so the order asserted below cannot be the input
        // order surviving untouched.
        expect(withdrawnVersionsFor('tx_trec_rei', Date.UTC(2025, 5, 1), [older, newer])
            .map((v) => v.version)).toEqual(['7-6', '7-5']);
    });
});
