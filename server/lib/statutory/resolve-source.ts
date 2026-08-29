/**
 * How ONE binding becomes ONE string.
 *
 * -- WHY THIS IS ITS OWN FILE ----------------------------------------------
 * `values.ts` answers a different question: how a whole declaration becomes the
 * values object, with groups expanded and overflow routed. This answers the
 * smaller one underneath it, and the two are read at different moments -- a
 * person adding a source kind comes here and nowhere else.
 *
 * The disciplines `values.ts` documents are kept, and two of them live HERE:
 * every refusal names the id somebody has to search for, and a value that
 * resolves to "the inspector answered nothing" is an empty string rather than a
 * missing key. Absent and empty are not the same fact, and only this side can
 * tell them apart.
 */
import type {
    StatutoryInspectionField,
    StatutoryValueSource,
    TemplateSchemaV2,
    TemplateItem,
} from '../../types/template-schema';
import { composeItemComments } from './item-comments';
import type { ItemCommentStates, ItemCommentTabs } from './item-comments';

/** One item's stored answers. Rich items answer on `rating`, everything else on
 *  `value`; attribute answers are keyed by attribute id. */
export interface StatutoryItemResult {
    rating?: unknown;
    value?: unknown;
    attributes?: Record<string, unknown>;
    /** Free text the inspector typed for this item. Part of what a form's
     *  Comments box says -- see `item-comments.ts` for the rest. */
    notes?: unknown;
    /** Which canned entries the inspector included, and their edits. */
    tabs?: ItemCommentStates;
}

/**
 * The inspection-level facts a binding may read, one per
 * `StatutoryInspectionField`. Null where the inspection has no answer.
 *
 * DERIVED FROM THE UNION ON PURPOSE, never a hand-written list of the same
 * names. A field added to `StatutoryInspectionField` becomes a REQUIRED key
 * here in the same commit, so every place that builds a facts object goes
 * type-red until it supplies the new value. A parallel list would let a new
 * member reach the form as `undefined` -- which stringifies to a blank box, and
 * a blank box on an authority's form reads as an inspector who did not answer.
 */
export type StatutoryInspectionFacts = Record<StatutoryInspectionField, string | null>;

export function fail(reason: string): never {
    throw new Error(`statutory values: ${reason}`);
}

/**
 * Stringify one resolved answer.
 *
 * `null`/`undefined` become an empty string rather than the words "null" or
 * "undefined" -- those would be PRINTED on the authority's form. See the module
 * header for why there is no `.trim()` here.
 */
export function asValue(raw: unknown): string {
    if (raw === null || raw === undefined) return '';
    return String(raw);
}

/** Every item in the snapshot, flattened. Sections carry no meaning for a form
 *  binding: the declaration names an item id, and where that item sits is the
 *  template's business rather than the form's. */
export function itemsById(snapshot: TemplateSchemaV2): Map<string, TemplateItem> {
    const out = new Map<string, TemplateItem>();
    for (const section of snapshot.sections ?? []) {
        for (const item of section.items ?? []) out.set(item.id, item);
    }
    return out;
}

export function requireItem(items: Map<string, TemplateItem>, itemId: string, ourField: string): TemplateItem {
    const item = items.get(itemId);
    if (!item) {
        fail(`binding "${ourField}" points at item "${itemId}", which this template does not contain`);
    }
    return item;
}

export function resolve(
    source: StatutoryValueSource,
    ourField: string,
    items: Map<string, TemplateItem>,
    results: Record<string, StatutoryItemResult>,
    facts: StatutoryInspectionFacts,
): string {
    switch (source.from) {
        case 'item': {
            requireItem(items, source.itemId, ourField);
            const result = results[source.itemId];
            // `rating` first: a rich item answers there, and an item carrying
            // both is answering with its rating.
            return asValue(result?.rating ?? result?.value);
        }
        case 'item_comments': {
            const item = requireItem(items, source.itemId, ourField);
            // The item is required to EXIST for the same reason `item` requires
            // it: a binding naming an item the template dropped is a broken
            // template, and the alternative -- compose nothing and carry on --
            // prints a blank Comments box on an authority's form.
            const result = results[source.itemId];
            return composeItemComments(
                item.tabs as ItemCommentTabs | undefined,
                result?.tabs,
                result?.notes,
                result?.attributes,
            );
        }
        case 'item_attribute': {
            const item = requireItem(items, source.itemId, ourField);
            const declared = (item.attributes ?? []).some((a) => a.id === source.attribute);
            if (!declared) {
                fail(
                    `binding "${ourField}" reads attribute "${source.attribute}" of item `
                    + `"${source.itemId}", which does not declare it`,
                );
            }
            return asValue(results[source.itemId]?.attributes?.[source.attribute]);
        }
        case 'inspection': {
            // The field union is closed, so this lookup cannot miss for any
            // value the compiler accepted. It is still checked, because a
            // template row is DATA and data outlives the type that described it.
            if (!(source.field in facts)) {
                fail(`binding "${ourField}" reads unknown inspection field "${source.field}"`);
            }
            return asValue(facts[source.field]);
        }
        case 'literal':
            return asValue(source.value);
        default: {
            // Unreachable through the type, and deliberately not silent: a row
            // written before a source kind was retired would otherwise be
            // skipped, and a skipped binding is a blank box on the form.
            const unknownSource = source as { from?: unknown };
            return fail(`binding "${ourField}" has unrecognised source kind "${String(unknownSource.from)}"`);
        }
    }
}
