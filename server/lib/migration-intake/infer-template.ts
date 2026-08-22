/**
 * Turning a document's text into a template's outline — and refusing to call
 * the result a template until somebody has looked at it.
 *
 * ⚠️ THIS CAPABILITY DOES NOT RUN TODAY. `output-classification.ts` refuses
 * `template_inference` on every credential source, and the chokepoint asks that
 * table before anything leaves the process, so nothing here can reach a
 * provider. That is not a flag and not a missing key: it is the posture table
 * saying the product does not ship this yet, and releasing it is an edit there,
 * reviewed like the product decision it is.
 *
 * The code exists anyway, and there are two reasons that is worth doing rather
 * than sloppy. The first is that the parts which decide what LEAVES — the
 * prompt, its version, its classification, and the request shape — are the
 * parts that need review before release, and reviewing them requires them to
 * exist. The second is that the part which decides what happens to what COMES
 * BACK is a validator, and a validator is worth more written early than late:
 * it is the thing standing between a model's confident paragraph and a template
 * an inspector fills in for the next year.
 *
 * WHAT IS DELIBERATELY NOT HERE.
 *
 *   - No provider, no adapter, no HTTP. A send goes through the one chokepoint
 *     that classifies, gates, records and meters, or it does not happen.
 *   - No metering vocabulary of its own. The cost split (`AiUsageKind`) has two
 *     members because it separates two cost profiles, and a capability that
 *     cannot run has no cost profile to separate. Adding a third metric now
 *     would mean a counter nothing increments, plus a hand-maintained entry in
 *     the capped-metric list beside it — a second number that has to agree with
 *     a first, introduced while the feature is dark. It gets one the day it
 *     runs, sized against what it actually costs.
 */
import { z } from 'zod';
import { AI_PROMPTS } from '../ai/prompts';
import type { AiRequest } from '../ai/provider';
import { TemplateSchemaV2Schema } from '../validations/template.schema';
import { DEFAULT_IMPORTED_RATING_OPTIONS } from './bundle';
import type { TemplateSchemaV2, TemplateItem, TemplateSection } from '../../types/template-schema';

/**
 * The whole of what this capability would send, as an object rather than as a
 * side effect.
 *
 * It exists so the outgoing payload can be READ — by a test, by a reviewer, by
 * anyone asking what leaves — without a provider, a key or a network. That
 * question was previously answerable only by reading the adapter and trusting
 * that the caller matched it.
 *
 * It renders through `AI_PROMPTS.templateInference`, never through a second
 * copy of the wording, so the text inspected here is the text a stored
 * `prompt_version` names. Building the request is NOT sending it: this function
 * reaches nothing, and the send — if this capability is ever released — goes
 * through the chokepoint with the versioned prompt, not with this object.
 *
 * ⚠️ It has no opinion about what is in `pages`, and must not grow one. The
 * scan that refuses a document carrying personal information runs BEFORE this,
 * and a builder that quietly dropped lines it disliked would make that refusal
 * look like it had worked while sending the rest.
 */
export function buildInferenceRequest(pages: readonly string[]): AiRequest {
    return { prompt: AI_PROMPTS.templateInference.render({ pages }) };
}

/* ── What comes back ─────────────────────────────────────────────────────── */

/**
 * What was wrong with one part of the outline, from a CLOSED list.
 *
 * Closed on purpose. An open string here becomes a sentence written at each
 * call site, and the screen that renders these has to group them; a set of four
 * is a set the interface can be built against. Where the detail is, the `at`
 * says.
 */
export type InferredProblemDetail =
    /** The model gave an item a type this product does not have. */
    | 'unknown item type'
    /** The model said it could not read something. Carried through, never dropped. */
    | 'could not be read'
    /** A heading was longer than a heading may be, and was cut. */
    | 'heading shortened to fit'
    /** The model returned a field nothing asked it for. */
    | 'field we did not ask for';

export interface InferredProblem {
    /** Where, in the outline's own words — `Roof > Covering`. Not an index: an
     *  operator looking at a preview has headings in front of them, not
     *  offsets. */
    at: string;
    detail: InferredProblemDetail;
}

/**
 * The result of reading a model's outline.
 *
 * `status` is a one-member union and that is the design, not an unfinished
 * enum. There is no value of this type that says the template was applied,
 * because this function cannot apply one — an inferred template is not a
 * template until somebody has looked at it, and `'staged'` is the only thing
 * this step can truthfully produce.
 */
export interface InferredOutline {
    status: 'staged';
    schema: TemplateSchemaV2;
    problems: InferredProblem[];
}

/**
 * The shape asked for, parsed permissively enough to SEE what was invented.
 *
 * `.passthrough()` rather than the default strip, and that is the whole reason
 * this schema is written out rather than reusing the template schema: stripping
 * an unexpected key is exactly the silent drop this step exists not to do. The
 * keys are kept so they can be named, and then not carried forward.
 */
const OutlineItemSchema = z.object({
    title: z.string().min(1),
    type: z.string().optional(),
}).passthrough();

const OutlineSectionSchema = z.object({
    title: z.string().min(1),
    items: z.array(OutlineItemSchema).default([]),
}).passthrough();

/**
 * `.min(1)` on the sections, so an outline with nothing in it is a REFUSAL and
 * not a successful conversion of nothing. An empty template validates, stages,
 * and shows the operator a screen with no rows and no reason — the most
 * expensive kind of pass, because it looks like the feature worked.
 */
const OutlineSchema = z.object({
    sections: z.array(OutlineSectionSchema).min(1),
    unreadable: z.array(z.string()).default([]),
});

/** The keys the outline was asked for. Anything else is named. */
const ASKED_FOR_SECTION = new Set(['title', 'items']);
const ASKED_FOR_ITEM = new Set(['title', 'type']);

/** Field lengths the template schema enforces. Restated here so the cut is
 *  reported rather than raised as a validation failure the operator cannot
 *  act on. */
const MAX_SECTION_TITLE = 50;
const MAX_ITEM_LABEL = 100;

/** Types an item may have. A `satisfies` rather than a cast, so a member that
 *  is not a real item type does not compile. A member MISSING from this list is
 *  safe in the other direction: it falls through to the named default below. */
const ITEM_TYPES = [
    'rich', 'text', 'boolean', 'textarea', 'number',
    'select', 'multi_select', 'date', 'photo_only',
] as const satisfies readonly TemplateItem['type'][];

/**
 * A rated item with nothing filled in.
 *
 * The tabs start EMPTY and must stay that way. The prompt asks for headings and
 * nothing else; a canned comment appearing here would be prose about a property
 * that no inspector wrote, sitting in a template that inspections are recorded
 * against for as long as the template lives.
 */
function emptyRichItem(id: string, label: string): TemplateItem {
    return {
        id,
        label,
        type: 'rich',
        ratingOptions: [...DEFAULT_IMPORTED_RATING_OPTIONS],
        tabs: { information: [], limitations: [], defects: [] },
    };
}

/**
 * A model's outline, read into a template structure — with everything it
 * invented, could not read, or overran named beside it.
 *
 * ⚠️ IT NEVER PRODUCES A TEMPLATE. It produces a STAGED structure and a list of
 * problems, and the difference is the product's existing principle applied:
 * model-assisted text is not a finding until you review it, so an inferred
 * outline is not a template until somebody has looked at it. Preview is that
 * looking, and there is no return value here that can skip it.
 *
 * ⚠️ THE PROBLEM LIST QUOTES THE DOCUMENT, and that is a deliberate difference
 * from the personal-information scan, which reports a page and a category and
 * never the text. The two are answering different questions. The scan quotes
 * nothing because its whole subject is text that should not be copied
 * anywhere; this list quotes headings because an operator cannot repair
 * "something on page 4" — and the text it quotes has already been through that
 * scan, which refused the document if it carried personal information.
 *
 * Asynchronous because it sits at the end of a model call and every caller is
 * already awaiting one; nothing in here does any I/O. Throwing rather than
 * returning a problem for the two refusals above is also deliberate: a
 * malformed outline and an empty one are not things an operator can correct on
 * a preview screen, so they are not offered one.
 */
export async function inferredToBundle(modelOutput: unknown): Promise<InferredOutline> {
    const outline = OutlineSchema.parse(modelOutput);
    const problems: InferredProblem[] = [];

    const sections: TemplateSection[] = outline.sections.map((rawSection, s) => {
        const sectionId = `s${s + 1}`;
        const title = clip(rawSection.title, MAX_SECTION_TITLE, rawSection.title, problems);
        nameExtraKeys(rawSection, ASKED_FOR_SECTION, rawSection.title, problems);

        const items: TemplateItem[] = rawSection.items.map((rawItem, i) => {
            const where = `${rawSection.title} > ${rawItem.title}`;
            const itemId = `${sectionId}i${i + 1}`;
            const label = clip(rawItem.title, MAX_ITEM_LABEL, where, problems);
            nameExtraKeys(rawItem, ASKED_FOR_ITEM, where, problems);

            const declared = rawItem.type;
            if (declared !== undefined && declared !== 'rich') {
                // NAMED EITHER WAY, AND HONOURED NEITHER WAY, and the second
                // half of that is the deliberate part.
                //
                // The prompt asks for headings and nothing else, so a type is
                // the model volunteering a guess about what kind of control the
                // field should be. Acting on it is the confident-wrong-answer
                // case: a guessed `boolean` silently strips an item of its
                // rating and its three comment tabs, and nobody notices until
                // an inspector is half way through an inspection wondering
                // where the defect tab went. A rated item is the recoverable
                // default — an operator who wanted a checkbox can say so in the
                // editor in a second, and the heading the model actually read
                // is kept either way.
                //
                // The two details are different because the two facts are: one
                // is a type this product does not have, which means the model
                // invented it; the other is a real type nobody asked for.
                problems.push(isItemType(declared)
                    ? { at: `${where} > type`, detail: 'field we did not ask for' }
                    : { at: where, detail: 'unknown item type' });
            }
            return emptyRichItem(itemId, label);
        });

        return { id: sectionId, title, items };
    });

    for (const text of outline.unreadable) {
        problems.push({ at: text, detail: 'could not be read' });
    }

    const schema: TemplateSchemaV2 = { schemaVersion: 2, sections };
    // The OUTPUT is validated too, not only the input. A converter can refuse
    // every malformed outline and still emit something the editor cannot open —
    // the two are different bugs, and only this catches the second.
    TemplateSchemaV2Schema.parse(schema);
    return { status: 'staged', schema, problems };
}

function isItemType(value: string): value is TemplateItem['type'] {
    return (ITEM_TYPES as readonly string[]).includes(value);
}

/** Cuts an over-long heading and SAYS SO. Cutting quietly leaves the operator
 *  reviewing a heading they never wrote, with nothing pointing at it. */
function clip(value: string, max: number, at: string, problems: InferredProblem[]): string {
    if (value.length <= max) return value;
    problems.push({ at, detail: 'heading shortened to fit' });
    return value.slice(0, max);
}

/** Names every key that was not asked for. They are not carried forward — the
 *  template schema is strict, and a field passed through is a field the editor
 *  then has to have an opinion about. */
function nameExtraKeys(
    raw: Record<string, unknown>,
    asked: ReadonlySet<string>,
    at: string,
    problems: InferredProblem[],
): void {
    for (const key of Object.keys(raw)) {
        if (asked.has(key)) continue;
        problems.push({ at: `${at} > ${key}`, detail: 'field we did not ask for' });
    }
}
