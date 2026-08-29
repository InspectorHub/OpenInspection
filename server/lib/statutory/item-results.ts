/**
 * The inspection's answers, keyed the way a binding names them.
 *
 * -- THE BUG THIS EXISTS TO CLOSE -------------------------------------------
 * A binding names an ITEM: `{ from: 'item', itemId: 'structural_foundations' }`.
 * An inspection does not store answers under item ids. It stores them under a
 * composite finding key -- `_default:structural:structural_foundations` -- so
 * that the same item can be answered separately per unit.
 *
 * The statutory collector was reading `results[itemId]` against the raw stored
 * object. Measured against real rows in a seeded database: every key is
 * composite, so every lookup missed, every binding resolved to the empty string,
 * and the authority's form rendered COMPLETELY BLANK. Nothing was red. The
 * fidelity gate passes, the render gate passes, every unit test passes -- they
 * build their `results` maps by hand, flat, which is the one shape the product
 * never produces. The only way to see it was to press the button.
 *
 * A blank box on an authority's form reads as an inspector who did not answer.
 * A blank FORM reads as an inspector who answered nothing at all, over their
 * signature.
 *
 * -- WHY THIS DOES NOT SILENTLY PICK A UNIT ---------------------------------
 * A multi-unit inspection answers one item once per unit. These forms describe
 * ONE dwelling -- TREC's is a single-family report -- so there is no honest way
 * to choose which unit's answer is "the" answer, and choosing quietly would
 * print one unit's findings under the address of the whole building. So the
 * default unit is what a form reads, and an item answered ONLY under some other
 * unit is reported rather than substituted.
 */
import { parseFindingKey, DEFAULT_UNIT } from '../finding-key';
import type { StatutoryItemResult } from './resolve-source';

/** What a stored answer set looks like before it is keyed by item. */
export type StoredItemResults = Readonly<Record<string, unknown>>;

export interface ItemResultsReading {
    /** Answers keyed by item id, ready for `collectStatutoryValues`. */
    results: Record<string, StatutoryItemResult>;
    /**
     * Item ids that were answered ONLY under a non-default unit. Not an error
     * here -- this function reports, the caller decides -- but never silently
     * folded into `results`.
     */
    skippedNonDefaultUnits: string[];
}

/**
 * Re-key one inspection's stored answers by item id.
 *
 * Accepts every shape the column has held, because the column is DATA and data
 * outlives the writer that shaped it: the current three-part composite key, the
 * two-part legacy key (`section:item`, no unit), and the flat bare item id that
 * predates both. `parseFindingKey` already knows all three; this only decides
 * what to do with what it returns.
 */
export function itemResultsFor(data: unknown): ItemResultsReading {
    const results: Record<string, StatutoryItemResult> = {};
    const nonDefault = new Set<string>();
    if (data === null || typeof data !== 'object') {
        return { results, skippedNonDefaultUnits: [] };
    }
    for (const [key, value] of Object.entries(data as StoredItemResults)) {
        if (value === null || typeof value !== 'object') continue;
        const { unitId, itemId } = parseFindingKey(key);
        if (unitId !== DEFAULT_UNIT) { nonDefault.add(itemId); continue; }
        // A later key does not overwrite an earlier one for the same item: the
        // only way two default-unit keys resolve to one item is a legacy key
        // sitting beside its migrated form, and the migrated one is written
        // first. Preferring the first keeps that pair readable rather than
        // order-dependent.
        if (itemId in results) continue;
        results[itemId] = value as StatutoryItemResult;
    }
    return {
        results,
        skippedNonDefaultUnits: [...nonDefault].filter((i) => !(i in results)).sort(),
    };
}
