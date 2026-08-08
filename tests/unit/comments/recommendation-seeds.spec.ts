/**
 * The shipped recommendation library carries recommendation TEXT, not prices.
 *
 * A seeded estimate is a number the reader attributes to the inspection company
 * that sent the report — but nobody at that company chose it, and it does not
 * know the property, the local trade market, or the date. So the seeds ship with
 * no money in them at all.
 *
 * The assertion is on the KEY SET of every entry, not on two named fields. An
 * earlier version compared `defaultEstimateMin !== null`, which went vacuously
 * green the moment those fields were deleted — the test would have kept passing
 * while a differently-named price field was added beside it. Asserting on EVERY
 * entry (not a sample) is the same point one level down.
 */
import { describe, it, expect } from 'vitest';
import { RECOMMENDATION_SEEDS } from '../../../server/data/recommendation-seeds';

const MONEY_KEY = /estimate|price|cost|amount|cents|dollar|fee|credit/i;

describe('RECOMMENDATION_SEEDS', () => {
    it('ships no money-shaped field on any entry', () => {
        const priced = RECOMMENDATION_SEEDS.flatMap((s) =>
            Object.keys(s)
                .filter((k) => MONEY_KEY.test(k))
                .map((k) => `${s.category} / ${s.name}: ${k}`),
        );

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
