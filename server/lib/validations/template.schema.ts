import { z } from '@hono/zod-openapi';
import { hasCycle, itemDepths, MAX_ITEM_DEPTH } from '../template-hierarchy';

/**
 * Spec 5B — Template schema (v2) validation.
 *
 * v2 is the single canonical template format. v1 (`type:'rating'` flat
 * items) is rejected outright at the validator boundary — pre-launch we
 * don't ship a migration shim. The shape below is intentionally broad:
 * every input that the template editor surfaces (rich + 8 other item
 * types, item attributes, default-recommendation, estimate ranges,
 * import-source metadata, per-section disclaimers, ...) is part of the
 * persisted schema so the editor never asks an inspector for data we
 * silently drop on the wire.
 */

// Widened (Authoring unification Plan-4 module K): CannedDefect.category
// references a tenant defect_categories.id (or a legacy seed name) rather
// than a hard-coded 3-value enum — see server/types/template-schema.ts.
const DefectCategorySchema = z.string().min(1);

/** The canonical property-type vocabulary. Exported because the marketplace
 *  catalogue's browse axis reuses it verbatim: a catalogue template exists to
 *  become a local `templates` row, so a second vocabulary there could not
 *  survive the import (see marketplace-browse.schema.ts). Distinct from the
 *  wizard's five-value underscore enum, which is NOT interchangeable. */
export const PropertyTypeEnum = z.enum(['single-family', 'multi-unit', 'commercial']);

/** Section applicability — gates a section by property type and (for commercial)
 *  by subtype. Empty/absent arrays mean "applies to all" (see sectionApplies). */
const SectionApplicabilitySchema = z.object({
    propertyTypes:      z.array(PropertyTypeEnum).optional().describe('Property types this section applies to; empty = all'),
    commercialSubtypes: z.array(z.string().min(1)).optional().describe('Commercial subtype ids this section applies to; empty = all commercial'),
}).strict();

const CannedInfoCommentSchema = z.object({
    id:      z.string().min(1).describe('Stable id of the canned information or limitation entry within the template; an inspection records which entries are included by this id.'),
    title:   z.string().min(1).describe('Short heading shown above the comment text in the editor.'),
    comment: z.string().describe('Plain-text body of the canned comment, inserted into the report when the entry is included on an inspection.'),
    default: z.boolean().describe('When true the entry is included automatically on new inspections; when false the inspector must switch it on.'),
    abbrev:  z.string().max(12).optional().describe('Optional shortcode of up to 12 characters that the inspector types in the editor to fill in this comment.'),
}).strict();

const CannedDefectSchema = z.object({
    id:       z.string().min(1).describe('Stable id of the canned defect entry within the template; an inspection records which entries are included by this id.'),
    title:    z.string().min(1).describe('Short heading naming the defect, shown above its comment in the editor and report.'),
    category: DefectCategorySchema.describe('Defect category the entry belongs to: the id of one of the company defect categories, or a legacy seed name. The category decides whether the defect appears in the report summary.'),
    location: z.string().describe('Free-text location of the defect in the property, for example the northeast corner; empty in a template and filled in by the inspector.'),
    comment:  z.string().describe('Plain-text narrative describing the defect, inserted into the report when the entry is included.'),
    photos:   z.array(z.string()).describe('Storage keys of photos attached to the canned defect at template level. Rarely used: photos taken during an inspection are stored with that inspection instead.'),
    default:  z.boolean().describe('When true the defect is included automatically on new inspections; when false the inspector must switch it on.'),
    abbrev:   z.string().max(12).optional().describe('Optional shortcode of up to 12 characters that the inspector types in the editor to fill in this defect.'),
}).strict();

const ItemTabsSchema = z.object({
    information: z.array(CannedInfoCommentSchema).describe('Canned information comments offered on the Information tab of the item: general statements about what was observed.'),
    limitations: z.array(CannedInfoCommentSchema).describe('Canned limitation comments offered on the Limitations tab of the item: conditions that restricted the inspection.'),
    defects:     z.array(CannedDefectSchema).describe('Canned defect entries offered on the Defects tab of the item; each carries a category, location, comment and photos.'),
}).strict();

/** Per-item sub-properties — only meaningful on the non-rich types. */
const ItemOptionsSchema = z.object({
    min:         z.number().nullable().optional().describe('Lowest value the number input accepts. Used by number items; null means no lower bound.'),
    max:         z.number().nullable().optional().describe('Highest value the number input accepts. Used by number items; null means no upper bound.'),
    unit:        z.string().optional().describe('Unit of measure shown beside the captured value in the report, for example yr or psi.'),
    step:        z.number().nullable().optional().describe('Increment the number input steps by. Used by number items; null leaves the browser default.'),
    placeholder: z.string().optional().describe('Hint text shown inside the empty input; when absent the item label is shown instead.'),
    maxLength:   z.number().nullable().optional().describe('Longest text the input accepts, in characters. Used by text and textarea items; null means no limit.'),
    choices:     z.array(z.string()).optional().describe('The options offered by a select or multi-select item; the chosen option text is what is stored in the results.'),
}).strict();

/**
 * One option an attribute offers: either a bare token, or that token paired
 * with the wording the authority's form prints beside its box.
 *
 * 🔴 THE VALUE IS WHAT GETS STORED. A statutory form is rendered by comparing
 * the stored answer to a mapping's `whenValue` byte for byte, so a label that
 * reached the results would print a blank official document. Widening `choices`
 * rather than adding a parallel `choiceLabels` map is what keeps the two from
 * being able to disagree — see `ItemChoice` in `server/types/template-schema.ts`.
 *
 * `.strict()` on the object half so a caller sending `{ value, title }` is
 * refused by name rather than having the label silently dropped, which would
 * put a raw token back on the inspector's screen with nothing to show for it.
 */
const ItemChoiceSchema = z.union([
    z.string(),
    z.object({
        value: z.string().min(1).describe('The token stored in the results and matched against a statutory form mapping'),
        label: z.string().min(1).describe('What the inspector reads on screen; never stored'),
    }).strict(),
]);

/** Optional sub-fields nested under an item, e.g. tonnage on an HVAC unit. */
const ItemAttributeTypeEnum = z.enum(['boolean', 'text', 'number', 'select', 'multi_select', 'date']);
const ItemAttributeSchema = z.object({
    id:             z.string().min(1).describe('Stable id of the attribute within its item; the value an inspector enters is stored under this id in the item attribute values.'),
    name:           z.string().min(1).describe('Label shown beside the attribute input in the editor.'),
    type:           ItemAttributeTypeEnum.describe('Kind of input the attribute uses, which also determines the type of the stored value.'),
    choices:        z.array(ItemChoiceSchema).optional().describe('Options offered by a select or multi-select attribute. A bare string is both stored value and label; the object form keeps a stored value distinct from its on-screen label.'),
    unit:           z.string().optional().describe('Unit of measure shown in brackets after the label of a number attribute.'),
    required:       z.boolean().optional().describe('Marks the attribute as one the inspector is expected to fill in.'),
    isSafety:       z.boolean().optional().describe('Marks the attribute as a safety concern.'),
    isDefect:       z.boolean().optional().describe('Marks that a poor reading of this attribute counts as a defect.'),
    recommendation: z.string().nullable().optional().describe('Prose advice on what to do when the attribute reads badly: the remedy to recommend, never a price.'),
    // No estimateMin / estimateMax. `.strict()` turns a caller that sends one
    // into a 400 naming the key — see BaseItemFields below for why the refusal
    // is loud here and a silent strip elsewhere.
}).strict();

/** Provenance for templates imported from upstream platforms. */
const ItemSourceSchema = z.object({
    platform:   z.string().min(1).describe('Name of the product or platform the template content was imported from.'),
    externalId: z.string().min(1).describe('Identifier of this record in the platform it was imported from, kept so the origin can be traced.'),
}).strict();

/** Common fields shared by every item type. */
const BaseItemFields = {
    id:                    z.string().min(1).describe('Stable id of the item within its section; inspection results are recorded against it, so it should not change once inspections use the template.'),
    label:                 z.string().min(1).max(100).describe('Name of the item, shown as its heading in the template editor, the inspection editor and the report.'),
    description:           z.string().optional().describe('Optional longer text saying what the item covers.'),
    icon:                  z.string().optional().describe('Optional icon key stored with the item.'),
    number:                z.string().optional().describe('Optional display number shown before the item label, such as 01.'),
    required:              z.boolean().optional().describe('Shows a Required badge on the item to mark it as one the inspector must complete.'),
    isSafety:              z.boolean().optional().describe('Shows a Safety badge on the item to mark it as a safety concern.'),
    defaultRecommendation: z.string().optional().describe('Prose remedy this item usually calls for, offered as the starting recommendation. Describes scope, not a cost.'),
    // No defaultEstimateMin / defaultEstimateMax.
    //
    // This is the one write in the repair-price family with a request boundary,
    // so it REFUSES rather than discards: every item schema below is `.strict()`,
    // so a payload carrying either key fails validation and names it. A write
    // that is accepted and then silently dropped leaves the caller with no
    // evidence, and an API that still accepts the field is still advertising the
    // capability. The results-write path has no such boundary — it arrives as a
    // CRDT update — and strips instead; see
    // `server/services/inspection/shared.ts`.
    attributes:            z.array(ItemAttributeSchema).optional().describe('Optional sub-fields captured beside the item rating, such as tonnage on an HVAC unit; each has its own input type.'),
    source:                ItemSourceSchema.nullable().optional().describe('Where the item was imported from; null or absent for items authored in the editor.'),
    // `.min(1)` is not decoration. An empty string reads as "has a parent" to
    // a truthiness check and as "no parent" to a lookup -- which is the exact
    // definition of a dangling node, arriving through a key that looks set.
    parentId:              z.string().min(1).nullable().optional().describe('Id of the item this one nests under, within the same section; null or absent = top level'),
} as const;

const RichItemSchema = z.object({
    ...BaseItemFields,
    type:          z.literal('rich').describe('Rated item: a rating from ratingOptions plus the three canned-comment tabs. This is the main inspection item type.'),
    ratingOptions: z.array(z.string().min(1)).min(1).describe('Rating labels offered at the top of the item card, in display order; at least one is required.'),
    tabs:          ItemTabsSchema.describe('The Information, Limitations and Defects canned-comment tabs for the item.'),
}).strict();

const TextItemSchema = z.object({
    ...BaseItemFields,
    type:    z.literal('text').describe('Single-line text item: the inspector types a short answer, stored as the item value.'),
    options: ItemOptionsSchema.optional().describe('Optional input settings for the text field, such as hint text and maximum length.'),
}).strict();

const BooleanItemSchema = z.object({
    ...BaseItemFields,
    type: z.literal('boolean').describe('Yes or no item: a checkbox whose state is stored as the item value.'),
}).strict();

const TextareaItemSchema = z.object({
    ...BaseItemFields,
    type:    z.literal('textarea').describe('Multi-line text item: the inspector types a longer answer, stored as the item value.'),
    options: ItemOptionsSchema.optional().describe('Optional input settings for the text area, such as hint text and maximum length.'),
}).strict();

const NumberItemSchema = z.object({
    ...BaseItemFields,
    type:    z.literal('number').describe('Numeric item: the inspector enters a number, stored as the item value and shown with its unit in the report.'),
    options: ItemOptionsSchema.optional().describe('Optional input settings for the number field: bounds, step, unit and hint text.'),
}).strict();

const SelectItemSchema = z.object({
    ...BaseItemFields,
    type:    z.literal('select').describe('Single-choice item: the inspector picks one option from options.choices.'),
    options: ItemOptionsSchema.optional().describe('Input settings for the select item; the options.choices list supplies the options.'),
}).strict();

const MultiSelectItemSchema = z.object({
    ...BaseItemFields,
    type:    z.literal('multi_select').describe('Multiple-choice item: the inspector ticks any of the options in options.choices.'),
    options: ItemOptionsSchema.optional().describe('Input settings for the multi-select item; the options.choices list supplies the options.'),
}).strict();

const DateItemSchema = z.object({
    ...BaseItemFields,
    type: z.literal('date').describe('Date item: the inspector picks a calendar date, stored as the item value.'),
}).strict();

const PhotoOnlyItemSchema = z.object({
    ...BaseItemFields,
    type:    z.literal('photo_only').describe('Photo-only item: no rating or text, the inspector only attaches photos.'),
    options: ItemOptionsSchema.optional().describe('Optional settings carried with the item. The photo-only control reads none of them.'),
}).strict();

const TemplateItemSchema = z.discriminatedUnion('type', [
    RichItemSchema,
    TextItemSchema,
    BooleanItemSchema,
    TextareaItemSchema,
    NumberItemSchema,
    SelectItemSchema,
    MultiSelectItemSchema,
    DateItemSchema,
    PhotoOnlyItemSchema,
]);

// S3-5 — a section title is bounded to surface obviously-bogus imports, the
// case being somebody pasting an entire paragraph into a "title".
//
// ⚠️ The bound was 50, chosen against a survey that said "current longest seed
// section title is 34 chars". That survey went stale twice over, and the second
// time it refused content this repository ships: the Texas TREC REI 7-6
// template's third section is `III. Heating, Ventilation and Air Conditioning
// Systems` — 54 characters, and the Commission's own wording read off the
// promulgated form. Nothing caught it, because that template reaches a
// workspace only through the marketplace and standalone could not open the
// marketplace at all; the refusal was unreachable rather than absent.
//
// 120 keeps the rule's actual purpose — one heading, never a paragraph — with
// room for an authority whose headings are longer than ours. Longest across all
// 17 seed templates today: 54 (TREC), then 44 (InterNACHI), then 36.
const TemplateSectionSchema = z.object({
    id:         z.string().min(1).describe('Stable id of the section within the template; items and report anchors are addressed through it.'),
    title:      z.string().min(1).max(120).describe('Section heading shown in the editor navigation and as the section title in the report; a heading, not a paragraph.'),
    icon:       z.string().optional().describe('Optional icon key stored with the section.'),
    identifier: z.string().optional().describe('Optional short code or numeral identifying the section, kept with the section when the template is saved.'),
    items:      z.array(TemplateItemSchema).describe('Ordered checklist items of the section; an item with a parentId nests under another item of the same section, and array order is the display order.'),
    // Track E2 (Spectora App.A) — per-section legal disclaimer rendered at
    // the bottom of the section in the published report. Null/empty when
    // unset. Free-form text (≤ 4 KB) so tenants can paste boilerplate.
    disclaimerText:  z.string().max(4000).nullable().optional().describe('Legal or explanatory disclaimer printed at the bottom of the section in the published report; null or empty prints nothing.'),
    // Track E2 — when true, the published report forces a page break BEFORE
    // this section in PDF output.
    alwaysPageBreak: z.boolean().optional().describe('When true the published report starts this section on a new page in print and PDF output.'),
    // Provenance from upstream platform imports (e.g. Spectora). The editor
    // surfaces this as a small colored dot next to the section title so
    // imported sections are visually distinguishable.
    source:          ItemSourceSchema.nullable().optional().describe('Where the section was imported from; the editor marks imported sections with a coloured dot.'),
    // PCA / multi-unit — gates a section by (propertyType, commercialSubtype)
    // via server/lib/section-applicability.ts sectionApplies(). Absent = applies
    // to every property type.
    // FROZEN (module A): retired from authoring UI; field retained so the OpenAPI
    // snapshot does not churn and already-stored templates still validate.
    applicableTo: SectionApplicabilitySchema.optional().describe('Property-type / commercial-subtype gating for this section'),
    // PCA / multi-unit — 'unit' sections repeat per unit in per-unit inspections
    // (Phase U). Absent defaults to 'common'.
    // FROZEN (module A): Phase-U per-unit scope placeholder; not authored in UI yet.
    defaultScope: z.enum(['common', 'unit']).optional().describe('common (once) or unit (repeats per unit)'),
}).strict().superRefine((section, ctx) => {
    // Item nesting is a property of the ITEMS ARRAY, not of any one item: a
    // single item's schema cannot see its own parent. So it is checked here,
    // at the only level that holds the whole list.
    const items = section.items as ReadonlyArray<{ id: string; parentId?: string | null }>;

    // ORDER IS LOAD-BEARING: cycles first.
    //
    // Depth is computed by walking up parent pointers, and a walk up a cycle
    // never terminates. Checking depth first would either hang or report "too
    // deep" -- an error that sends the author to shorten a tree that is not
    // too deep, it is knotted.
    if (hasCycle(items)) {
        ctx.addIssue({
            code: 'custom',
            path: ['items'],
            message: 'items contain a parentId cycle',
        });
        return;
    }

    const known = new Set(items.map((i) => i.id));
    for (const item of items) {
        const parentId = item.parentId ?? null;
        if (parentId === null) continue;
        // A parent in ANOTHER section is not a parent. Sections are the
        // report's pagination and table-of-contents unit, so a cross-section
        // parent would leave "how many items does this section have" -- a
        // number already rendered in several places -- with no definition.
        if (!known.has(parentId)) {
            ctx.addIssue({
                code: 'custom',
                path: ['items'],
                message: `item ${item.id} names parentId ${parentId}, which is not an item in this section`,
            });
        }
    }

    for (const [id, depth] of itemDepths(items)) {
        if (depth >= MAX_ITEM_DEPTH) {
            ctx.addIssue({
                code: 'custom',
                path: ['items'],
                message: `item ${id} nests deeper than ${MAX_ITEM_DEPTH} levels`,
            });
        }
    }
});

const RatingLevelSchema = z.object({
    id:           z.string().min(1).describe('Id of the rating level, which is the value stored as an item rating in the inspection results.'),
    label:        z.string().min(1).describe('Full name of the rating level shown to the inspector and in the report, for example Satisfactory.'),
    abbreviation: z.string().optional().describe('Short code for the level shown on compact rating buttons.'),
    color:        z.string().optional().describe('Colour of the level as a hex value, used for its button and report chip.'),
    severity:     z.enum(['good', 'minor', 'marginal', 'significant']).optional().describe('Severity bucket the level falls in; the report summary and the rating contradiction check use it to tell good ratings from problems.'),
    isDefect:     z.boolean().optional().describe('Whether this level counts as a defect.'),
    pausesAdvance: z.boolean().optional().describe('Pause auto-advance after selecting this level (focus notes)'),
    default:      z.boolean().optional().describe('Marks the level the template treats as its default rating.'),
    description:  z.string().optional().describe('Explanation of what the level means, for example Item is functioning as intended.'),
}).strict();

const RatingSystemSchema = z.object({
    name:           z.string().optional().describe('Display name of the rating system, for example Standard 5-Level.'),
    defaultLevelId: z.string().optional().describe('Id of the level treated as the default rating; should match the id of one of the levels.'),
    source:         z.string().nullable().optional().describe('Where the rating system came from when it was imported; null when authored here.'),
    levels:         z.array(RatingLevelSchema).describe('The ordered rating levels an inspector can apply to items.'),
}).strict();

/**
 * Top-level template schema document. v2 only.
 *
 * ⚠️ `statutoryForm` IS DELIBERATELY ABSENT FROM THIS OBJECT, AND THE `.strict()`
 * BELOW IS WHY THAT MATTERS. A template that declares it produces an
 * authority's own form is supplied with the software; the only way one can come
 * into being is the platform writing the row directly. This schema is the
 * tenant-facing surface, and `.strict()` makes it a closed door: a workspace
 * cannot smuggle a declaration in on a template it authors, and gets that for
 * free rather than from a rule somebody has to remember to apply.
 *
 * ADDING THE KEY HERE OPENS THAT DOOR. It would not be a loosening of a
 * validator — it would be a decision that workspaces may declare their own
 * statutory forms, which is a different product.
 *
 * The other half of the enforcement lives in
 * `lib/middleware/refuse-statutory-template-edit.ts`: `.strict()` alone answers
 * an edit to an EXISTING declared template with `unrecognized_keys`, which
 * tells an inspector the software does not recognise one of its own fields.
 * The middleware answers first, and says who owns the template instead.
 */
export const TemplateSchemaV2Schema = z.object({
    schemaVersion: z.literal(2).describe('Template format version. Only version 2 is accepted; the older flat format is rejected.'),
    sections:      z.array(TemplateSectionSchema).describe('Ordered sections of the checklist, each with its own items.'),
    ratingSystem:  RatingSystemSchema.optional().describe('Rating levels embedded in this template; inspections copy them when created, so later edits do not change existing inspections.'),
    // PCA / multi-unit — template-level property classification. Mirrored to the
    // templates.property_type / commercial_subtype columns server-side on save.
    propertyType:      PropertyTypeEnum.optional().describe('single-family | multi-unit | commercial'),
    commercialSubtype: z.string().min(1).optional().describe('Commercial subtype id; only meaningful when propertyType = commercial'),
}).strict();

/**
 * Validation schema for inspection templates (create).
 *
 * Schema must be valid v2. Either pass the parsed object or a JSON string
 * — string form is parsed and re-validated to give a clean error path.
 */
export const CreateTemplateSchema = z.object({
    name: z.string().min(1, 'Template name is required').max(100).describe('Template name shown in template pickers.'),
    defaultProfileId: z.string().nullable().optional().describe('Default report appearance profile id for inspections from this template; null inherits the tenant default'),
    schema: z.union([
        z.string().transform((s, ctx) => {
            try {
                return JSON.parse(s) as unknown;
            } catch {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'schema is not valid JSON' });
                return z.NEVER;
            }
        }).pipe(TemplateSchemaV2Schema),
        TemplateSchemaV2Schema,
    ]).describe('Template checklist definition in the v2 schema format, sent as an object or as a JSON string that is parsed and validated.'),
});

/**
 * Validation schema for updating a template.
 */
export const UpdateTemplateSchema = CreateTemplateSchema.partial();
