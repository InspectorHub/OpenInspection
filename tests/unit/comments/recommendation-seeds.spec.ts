/**
 * The shipped recommendation library carries recommendation TEXT, not prices.
 *
 * A seeded estimate is a number the reader attributes to the inspection company
 * that sent the report — but nobody at that company chose it, and it does not
 * know the property, the local trade market, or the date. So the seeds ship with
 * no money in them at all, and a tenant who wants estimates types their own.
 *
 * Asserting on EVERY entry (not a sample) is the point: 23 of the 80 were
 * already null, so a spot check lands on a null one and passes while 57 priced
 * rows sail through.
 */
import { describe, it, expect } from 'vitest';
import { RECOMMENDATION_SEEDS } from '../../../server/data/recommendation-seeds';

describe('RECOMMENDATION_SEEDS', () => {
    it('ships no price on any entry', () => {
        const priced = RECOMMENDATION_SEEDS.filter(
            (s) => s.defaultEstimateMin !== null || s.defaultEstimateMax !== null,
        ).map((s) => `${s.category} / ${s.name}`);

        // Print the offenders, not just a count — a bare `toBe(0)` makes the
        // next person diff 80 lines by hand to find which ones came back.
        expect(priced).toEqual([]);
    });

    it('still ships the recommendation content the library exists for', () => {
        // Guards the other direction: "no prices" must not be achieved by
        // emptying the file. Deleting every seed would satisfy the test above.
        expect(RECOMMENDATION_SEEDS).toHaveLength(80);
        for (const s of RECOMMENDATION_SEEDS) {
            expect(s.category).toBeTruthy();
            expect(s.name).toBeTruthy();
            expect(s.defaultRepairSummary.length).toBeGreaterThan(10);
        }
    });
});
