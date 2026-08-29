import { describe, it, expect } from 'vitest';
import { itemResultsFor } from '../../../server/lib/statutory/item-results';
import { findingKey } from '../../../server/lib/finding-key';

/**
 * Re-keying an inspection's answers by item id.
 *
 * -- WHY EVERY FIXTURE HERE IS BUILT WITH `findingKey` -----------------------
 * The bug this closes survived a fidelity gate, a render gate and three dozen
 * unit specs, because every one of those built its `results` map BY HAND, flat,
 * keyed by item id. The product has never written that shape. So the fixtures
 * below are constructed with the same function the editor calls, and a spec that
 * hand-wrote `{ foundations: {...} }` would be re-testing the assumption that
 * was wrong.
 */
describe('itemResultsFor', () => {
    it('reads the composite key the editor actually writes', () => {
        const stored = {
            [findingKey(null, 'structural', 'structural_foundations')]: { rating: 'deficient' },
            [findingKey(null, 'electrical', 'electrical_other')]: { rating: 'not_present' },
        };
        expect(itemResultsFor(stored).results).toEqual({
            structural_foundations: { rating: 'deficient' },
            electrical_other: { rating: 'not_present' },
        });
    });

    it('does NOT find anything when the lookup is the bare item id', () => {
        // The positive control for the assertion above, and the shape of the
        // defect itself: this is exactly what the collector used to do.
        const stored = {
            [findingKey(null, 'structural', 'structural_foundations')]: { rating: 'deficient' },
        };
        expect((stored as Record<string, unknown>).structural_foundations).toBeUndefined();
    });

    it('still reads the two older key shapes the column has held', () => {
        // The column is DATA and outlives the writer that shaped it.
        expect(itemResultsFor({
            'structural:structural_walls': { rating: 'inspected' },   // legacy, no unit
            structural_windows: { rating: 'not_inspected' },          // flat, older still
        }).results).toEqual({
            structural_walls: { rating: 'inspected' },
            structural_windows: { rating: 'not_inspected' },
        });
    });

    it('carries the whole answer through, not just the rating', () => {
        // `item_comments` needs notes and tab states; `item_attribute` needs
        // attributes. Dropping any of them prints a blank box.
        const entry = {
            rating: 'deficient',
            notes: 'Cracking at the north corner.',
            tabs: { defects: [{ cannedId: 'd1', included: true }] },
            attributes: { foundation_type: 'Slab on grade' },
        };
        expect(itemResultsFor({ [findingKey(null, 'structural', 'structural_foundations')]: entry })
            .results.structural_foundations).toEqual(entry);
    });

    it('reports an item answered only outside the default unit, and does not substitute it', () => {
        // One form describes one dwelling. Silently promoting unit B's answer
        // would print its findings under the whole building's address.
        const reading = itemResultsFor({
            [findingKey('unit-b', 'structural', 'structural_walls')]: { rating: 'deficient' },
        });
        expect(reading.results).toEqual({});
        expect(reading.skippedNonDefaultUnits).toEqual(['structural_walls']);
    });

    it('does not report an item that ALSO has a default-unit answer', () => {
        const reading = itemResultsFor({
            [findingKey(null, 'structural', 'structural_walls')]: { rating: 'inspected' },
            [findingKey('unit-b', 'structural', 'structural_walls')]: { rating: 'deficient' },
        });
        expect(reading.results.structural_walls).toEqual({ rating: 'inspected' });
        expect(reading.skippedNonDefaultUnits).toEqual([]);
    });

    it('survives the shapes a column can genuinely be in', () => {
        for (const junk of [null, undefined, 'not an object', 42, []]) {
            expect(itemResultsFor(junk).results).toEqual({});
        }
        // A key present with a non-object value is skipped rather than stored:
        // `results[itemId]?.rating` on a string would read `undefined` and print
        // a blank, which is the failure this whole module is about.
        expect(itemResultsFor({
            [findingKey(null, 's', 'i')]: 'oops',
        }).results).toEqual({});
    });
});
