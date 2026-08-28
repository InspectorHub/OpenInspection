/**
 * Turn a template's statutory declaration into the values a form is rendered
 * from.
 *
 * This is the upstream end of the boundary `render.ts` documents at length, and
 * it keeps three disciplines.
 *
 * -- 1. ABSENT AND EMPTY ARE DIFFERENT, AND ONLY THIS SIDE CAN TELL ----------
 * Measured against the format: a PDF field set to an empty string is stored by
 * storing nothing, so it reads back identically to one that was never set. No
 * reader of the finished document can distinguish them. So a binding that
 * resolves to "the inspector answered nothing" emits the KEY with an empty
 * string, while a binding that cannot be resolved at all does not emit a key --
 * it throws. A missing key is what the renderer refuses on for a required
 * field, and that refusal is meant for a broken template, never for an
 * inspection somebody has not finished yet.
 *
 * There is a third case, and it is neither: a `signature` binding emits NO key
 * at all and throws nothing. It resolves by reference where the document is
 * produced, because a signature image must never enter this object -- see
 * `StatutoryValueSource`.
 *
 * -- 2. EVERY REFUSAL NAMES THE THING ----------------------------------------
 * A binding that points at an item or an attribute the template does not have
 * is a broken template, and the tempting alternative -- yield '' and carry on --
 * puts a blank on a statutory document. A blank looks exactly like an answer
 * nobody had, which is the one thing this whole subsystem exists to prevent.
 * So it throws, and the message carries the id, because the id is what the
 * person fixing it has to search for.
 *
 * -- 3. ONE REFUSAL, ONE PLACE -----------------------------------------------
 * This function does NOT check that every value it produces has somewhere to go
 * on the form, and it does not check that every field the form requires has
 * been produced. `checkValuesAgainstMap` in `render.ts` owns both. A second
 * half-implemented copy of that check here is exactly how the next person comes
 * to fix only one of them.
 *
 * -- Why a Record and not a Map ----------------------------------------------
 * `renderStatutoryForm` already takes `Record<string, string>` and it shipped
 * first. Handing it a Map would mean converting at the call site, and that is a
 * conversion which exists only because two authors disagreed.
 *
 * WARNING: VALUES ARE STRINGIFIED BUT NEVER TRIMMED. Trimming would silently
 * eat a deliberate leading space, and we do not know which box on which
 * authority's form needs one for its typesetting. This is a decision, not an
 * oversight -- it is written down because the next reader's instinct will be to
 * add `.trim()`, and doing so would look like tidying.
 */
import type {
    StatutoryFormDeclaration,
    StatutoryInspectionField,
    StatutoryValueSource,
    TemplateSchemaV2,
    TemplateItem,
} from '../../types/template-schema';

/** One item's stored answers. Rich items answer on `rating`, everything else on
 *  `value`; attribute answers are keyed by attribute id. */
export interface StatutoryItemResult {
    rating?: unknown;
    value?: unknown;
    attributes?: Record<string, unknown>;
}

/** The inspection-level facts a binding may read, one per
 *  `StatutoryInspectionField`. Null where the inspection has no answer. */
export type StatutoryInspectionFacts = Record<StatutoryInspectionField, string | null>;

function fail(reason: string): never {
    throw new Error(`statutory values: ${reason}`);
}

/**
 * Stringify one resolved answer.
 *
 * `null`/`undefined` become an empty string rather than the words "null" or
 * "undefined" -- those would be PRINTED on the authority's form. See the module
 * header for why there is no `.trim()` here.
 */
function asValue(raw: unknown): string {
    if (raw === null || raw === undefined) return '';
    return String(raw);
}

/** Every item in the snapshot, flattened. Sections carry no meaning for a form
 *  binding: the declaration names an item id, and where that item sits is the
 *  template's business rather than the form's. */
function itemsById(snapshot: TemplateSchemaV2): Map<string, TemplateItem> {
    const out = new Map<string, TemplateItem>();
    for (const section of snapshot.sections ?? []) {
        for (const item of section.items ?? []) out.set(item.id, item);
    }
    return out;
}

function requireItem(items: Map<string, TemplateItem>, itemId: string, ourField: string): TemplateItem {
    const item = items.get(itemId);
    if (!item) {
        fail(`binding "${ourField}" points at item "${itemId}", which this template does not contain`);
    }
    return item;
}

function resolve(
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

/**
 * Collect every value a declaration binds.
 *
 * @param declaration the template's `statutoryForm`.
 * @param snapshot the template snapshot the inspection actually ran against --
 *   not the current template row, which may have moved on since.
 * @param results stored answers, keyed by item id.
 * @param facts inspection-level answers, one per closed field name.
 * @returns our field name -> the string to place on the form. Every binding
 *   except a signature produces a key; a binding that cannot be resolved throws
 *   instead.
 */
export function collectStatutoryValues(
    declaration: StatutoryFormDeclaration,
    snapshot: TemplateSchemaV2,
    results: Record<string, StatutoryItemResult>,
    facts: StatutoryInspectionFacts,
): Record<string, string> {
    const items = itemsById(snapshot);
    const values: Record<string, string> = {};
    for (const [ourField, source] of Object.entries(declaration.bindings)) {
        // Signatures resolve by reference in the produce service. They are
        // deliberately absent here rather than empty -- see StatutoryValueSource.
        if (source.from === 'signature') continue;
        values[ourField] = resolve(source, ourField, items, results, facts);
    }
    return values;
}
