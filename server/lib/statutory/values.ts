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
 * -- 3. A REPEATED BLOCK IS EXPANDED HERE, AND OVERFLOW IS ROUTED HERE -------
 * A form's repeated blocks (`electrical_panel`, `roof`) are declared as groups
 * and become one key per slot per field, `electrical_panel[0].total_amps`. This
 * is the only place that expansion happens, and therefore the only place that
 * knows an inspection recorded more instances than the page holds.
 *
 * The extra ones are not dropped and are no longer refused on sight. The form
 * itself says where they go -- the Citizens four-point form prints "(use
 * additional pages if needed)" on its Additional Comments box -- so a group may
 * nominate that field as `overflowTo`, and the extra instances are appended to
 * it as sentences that name themselves. The refusal is the LAST link now, not
 * the first: no destination declared, or a destination that cannot hold the
 * result, and the document stops. What must never happen is unchanged -- a third
 * panel that reaches the renderer as an empty column reads exactly like an
 * inspector who did not answer.
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
    groupFieldName, refuseOverCapacity,
    refuseOverflowThatDoesNotFit, validateGroups,
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
type StatutoryGroupInstance = Readonly<Record<string, unknown>>;

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
 * Expand one declaration's groups into `values`, refusing an overflow that has
 * nowhere to go.
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
    instances: StatutoryGroupInstances,
    values: Record<string, string>,
): void {
    validateGroups(groups);

    // A BINDING ONTO A PRINTED SLOT IS ALLOWED, AND IT WINS.
    //
    // This used to be refused, on the reasoning that two writers of one key make
    // the loser vanish without a trace. The reasoning was sound and the premise
    // expired: it was written when a statutory form was assumed to have its own
    // entry surface, so a slot's value could only sensibly come from a group
    // instance. Entry is now the ordinary inspection editor and the form is a
    // projection of it, which makes a printed slot an ordinary item -- and an
    // item's value arrives as a binding. Refusing that refused the normal case.
    //
    // Nothing vanishes, because the order below is load-bearing: slots are
    // written from the instances FIRST and the binding loop overwrites them, so
    // where both exist the binding is what the form carries. The editor reads
    // the same bindings to know which item holds which slot, so the two agree by
    // construction rather than by convention.

    // Every capacity with nowhere to overflow to is judged BEFORE any value is
    // written. An overflow is a fact about the inspection as a whole, and
    // refusing it halfway through would leave a caller holding a
    // partly-populated object it has no reason to distrust.
    //
    // A group that nominates a destination is NOT judged here, because it has
    // not failed yet: its extra instances are routed by `routeOverflow` once the
    // bindings have been resolved, and only a destination that cannot hold them
    // refuses.
    for (const group of groups) {
        if (group.overflowTo === undefined) {
            refuseOverCapacity(group, (instances[group.id] ?? []).length);
        }
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
 * One overflowing instance, written as a sentence somebody can read.
 *
 * IT CARRIES ITS OWN ATTRIBUTION because nothing around it will. It lands in a
 * comments box among the inspector's own prose, where "60" and "31" mean
 * nothing; the reader has to be able to tell what this is and which instance it
 * was, so the block's name and the instance's number are part of the text.
 *
 * The number is the position on the form counted from one — the third panel is
 * "3" — rather than the array index, because the person reading it is counting
 * panels in a house and not offsets in an object.
 *
 * A field the inspector left blank is left out. This is prose in a comments box,
 * and "Panel age:" followed by nothing tells a reader less than silence while
 * suggesting something went missing. An instance with no answers at all still
 * gets a line, because the fact that a third panel EXISTS is the thing an
 * overflow must never lose.
 */
function overflowLine(group: FieldGroup, index: number, instance: StatutoryGroupInstance): string {
    const answered = group.fields
        .map((field) => [field, asValue(instance[field])] as const)
        .filter(([, value]) => value !== '')
        .map(([field, value]) => `${fieldLabel(field)}: ${value}`);
    const body = answered.length > 0 ? `${answered.join('; ')}.` : 'no answers recorded.';
    return `${group.label} ${index + 1} — ${body}`;
}

/**
 * `total_amps` -> `Total amps`.
 *
 * The declaration's own field name, tidied. A group's fields carry no printed
 * label the way its slots do -- `slotLabels` exists because the form prints
 * those words and this has no equivalent, so inventing one here would put
 * wording on the page that nobody measured.
 */
function fieldLabel(field: string): string {
    const words = field.replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Write the instances the slots could not hold into the field the form nominates.
 *
 * -- WHY THIS RUNS AFTER THE BINDINGS ----------------------------------------
 * The destination is an ordinary bound field, so the bindings loop writes it. A
 * routed line placed before that loop would be overwritten by the binding
 * without a trace, and the page would come out looking exactly as if no third
 * panel had ever been recorded.
 *
 * -- WHY IT APPENDS, AND WHY HIS TEXT COMES FIRST ----------------------------
 * What he wrote is the point and this is the ledger. He is also not looking at
 * this box while he edits the panel -- the panel's fields are in the electrical
 * section and the comments box is printed at the end of the form -- so anything
 * overwritten here would disappear somewhere he cannot see it.
 */
function routeOverflow(
    groups: readonly FieldGroup[],
    instances: StatutoryGroupInstances,
    values: Record<string, string>,
): void {
    for (const group of groups) {
        const destination = group.overflowTo;
        if (destination === undefined) continue;
        const recorded = instances[group.id] ?? [];
        if (recorded.length <= group.capacity) continue;

        const lines = recorded
            .slice(group.capacity)
            .map((instance, offset) => overflowLine(group, group.capacity + offset, instance));
        // The box holds ONE text, so the existing value is part of what has to
        // fit -- measuring only our addition would pass and still overrun.
        const existing = values[destination] ?? '';
        const combined = existing === ''
            ? lines.join('\n')
            : [existing, ...lines].join('\n');
        refuseOverflowThatDoesNotFit(group, recorded.length, destination, combined.length);
        values[destination] = combined;
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
        expandGroups(declaration.groups, instances, values);
    }
    for (const [ourField, source] of Object.entries(declaration.bindings)) {
        // Signatures resolve by reference in the produce service. They are
        // deliberately absent here rather than empty -- see StatutoryValueSource.
        if (source.from === 'signature') continue;
        values[ourField] = resolve(source, ourField, items, results, facts);
    }
    // Last, because an overflow is appended to a destination the loop above has
    // just written, and because the refusal it can still raise is the END of the
    // chain rather than the start of it.
    if (declaration.groups !== undefined) {
        routeOverflow(declaration.groups, instances, values);
    }
    return values;
}
