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
 * -- 3. A REPEATED BLOCK IS EXPANDED HERE, AND OVERFLOW IS REFUSED HERE ------
 * A form's repeated blocks (`electrical_panel`, `roof`) are declared as groups
 * and become one key per slot per field, `electrical_panel[0].total_amps`. This
 * is the only place that expansion happens, and therefore the only place that
 * can refuse an inspection with more instances than the page holds -- the
 * refusal `groups.ts` exists for. An inspection with three panels and a form
 * with two slots stops here rather than arriving at the renderer as a third
 * panel with nowhere to go, which the renderer would draw as an empty column.
 *
 * -- 4. ONE REFUSAL, ONE PLACE -----------------------------------------------
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
    FieldGroup,
    StatutoryFormDeclaration,
    StatutoryInspectionField,
    StatutoryValueSource,
    TemplateSchemaV2,
    TemplateItem,
} from '../../types/template-schema';
import {
    expectedGroupFields, groupFieldName, refuseOverCapacity, validateGroups,
} from './groups';

/** One item's stored answers. Rich items answer on `rating`, everything else on
 *  `value`; attribute answers are keyed by attribute id. */
export interface StatutoryItemResult {
    rating?: unknown;
    value?: unknown;
    attributes?: Record<string, unknown>;
}

/**
 * The inspection-level facts a binding may read, one per
 * `StatutoryInspectionField`. Null where the inspection has no answer.
 *
 * DERIVED FROM THE UNION ON PURPOSE, never a hand-written list of the same
 * names. A field added to `StatutoryInspectionField` becomes a REQUIRED key
 * here in the same commit, so every place that builds a facts object goes
 * type-red until it supplies the new value. A parallel list would let a new
 * member reach the form as `undefined` — which stringifies to a blank box, and
 * a blank box on an authority's form reads as an inspector who did not answer.
 */
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
 * What ONE instance of a repeated block answered, keyed by the group's own
 * field names (`total_amps`) -- never by the expanded slot name. The slot index
 * is the position in the array, because that is what the form's own slot order
 * means, and duplicating it into the key would let the two disagree.
 */
export type StatutoryGroupInstance = Readonly<Record<string, unknown>>;

/**
 * Everything the inspection recorded for each repeated block, group id ->
 * instances in the order the form prints its slots.
 *
 * How many arrived is the fact the capacity refusal is made against, which is
 * why the array is passed whole rather than pre-truncated to `capacity`: a
 * caller that trimmed it first would hand this function a form that fits and
 * lose the overflow it was supposed to report.
 */
export type StatutoryGroupInstances = Readonly<Record<string, readonly StatutoryGroupInstance[]>>;

/**
 * Expand one declaration's groups into `values`, refusing an overflow.
 *
 * EVERY SLOT GETS A KEY, up to `capacity`, whether or not an instance was
 * recorded for it. The slot is PRINTED on the authority's page whether or not
 * the house has a second panel, so an unrecorded slot is the same fact as an
 * item nobody answered: the key exists and the answer is empty. Emitting no key
 * would instead read as "this field was never bound", which is what the renderer
 * refuses on for a required field -- a refusal meant for a broken map, never for
 * a house with one electrical panel.
 */
function expandGroups(
    groups: readonly FieldGroup[],
    bindings: StatutoryFormDeclaration['bindings'],
    instances: StatutoryGroupInstances,
    values: Record<string, string>,
): void {
    validateGroups(groups);

    // A binding and a group must not both claim one slot. They are written into
    // the same object, so the loser vanishes without a trace and the form
    // carries whichever happened to be written last -- a value that is wrong in
    // a way no count of "fields supplied" can show.
    const claimed = expectedGroupFields(groups).filter((name) => name in bindings);
    if (claimed.length > 0) {
        fail(`${claimed.length} field(s) are claimed by both a group and a binding: `
            + `${claimed.join(', ')}. A slot belongs to its group; bind the value into the `
            + 'group instance instead.');
    }

    // Every capacity is judged BEFORE any value is written. An overflow is a
    // fact about the inspection as a whole, and refusing it halfway through
    // would leave a caller holding a partly-populated object it has no reason
    // to distrust.
    for (const group of groups) {
        refuseOverCapacity(group, (instances[group.id] ?? []).length);
    }

    for (const group of groups) {
        const recorded = instances[group.id] ?? [];
        for (let index = 0; index < group.capacity; index++) {
            const instance = recorded[index];
            for (const field of group.fields) {
                values[groupFieldName(group.id, index, field)] = asValue(instance?.[field]);
            }
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
 * @param instances what the inspection recorded for each repeated block. Empty
 *   by default, which is the ordinary case: most forms declare no groups, and a
 *   declaration with none behaves exactly as it did before groups existed.
 * @returns our field name -> the string to place on the form. Every binding
 *   except a signature produces a key, and every slot of every declared group
 *   produces one; a binding that cannot be resolved, and a block with more
 *   instances than the form holds, throw instead.
 */
export function collectStatutoryValues(
    declaration: StatutoryFormDeclaration,
    snapshot: TemplateSchemaV2,
    results: Record<string, StatutoryItemResult>,
    facts: StatutoryInspectionFacts,
    instances: StatutoryGroupInstances = {},
): Record<string, string> {
    const items = itemsById(snapshot);
    const values: Record<string, string> = {};
    // Groups first, so a declaration that is broken or a house that overflows
    // the page is refused before any value is resolved.
    if (declaration.groups !== undefined) {
        expandGroups(declaration.groups, declaration.bindings, instances, values);
    }
    for (const [ourField, source] of Object.entries(declaration.bindings)) {
        // Signatures resolve by reference in the produce service. They are
        // deliberately absent here rather than empty -- see StatutoryValueSource.
        if (source.from === 'signature') continue;
        values[ourField] = resolve(source, ourField, items, results, facts);
    }
    return values;
}
