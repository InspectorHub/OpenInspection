import { z } from '@hono/zod-openapi';

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

const DefectCategoryEnum = z.enum(['maintenance', 'recommendation', 'safety']);

const CannedInfoCommentSchema = z.object({
    id:      z.string().min(1),
    title:   z.string().min(1),
    comment: z.string(),
    default: z.boolean(),
}).strict();

const CannedDefectSchema = z.object({
    id:       z.string().min(1),
    title:    z.string().min(1),
    category: DefectCategoryEnum,
    location: z.string(),
    comment:  z.string(),
    photos:   z.array(z.string()),
    default:  z.boolean(),
}).strict();

const ItemTabsSchema = z.object({
    information: z.array(CannedInfoCommentSchema),
    limitations: z.array(CannedInfoCommentSchema),
    defects:     z.array(CannedDefectSchema),
}).strict();

/** Per-item sub-properties — only meaningful on the non-rich types. */
const ItemOptionsSchema = z.object({
    min:         z.number().nullable().optional(),
    max:         z.number().nullable().optional(),
    unit:        z.string().optional(),
    step:        z.number().nullable().optional(),
    placeholder: z.string().optional(),
    maxLength:   z.number().nullable().optional(),
    choices:     z.array(z.string()).optional(),
    minPhotos:   z.number().nullable().optional(),
}).strict();

/** Optional sub-fields nested under an item, e.g. tonnage on an HVAC unit. */
const ItemAttributeTypeEnum = z.enum(['boolean', 'text', 'number', 'select', 'multi_select', 'date']);
const ItemAttributeSchema = z.object({
    id:             z.string().min(1),
    name:           z.string().min(1),
    type:           ItemAttributeTypeEnum,
    choices:        z.array(z.string()).optional(),
    unit:           z.string().optional(),
    required:       z.boolean().optional(),
    isSafety:       z.boolean().optional(),
    isDefect:       z.boolean().optional(),
    recommendation: z.string().nullable().optional(),
    estimateMin:    z.number().nullable().optional(),
    estimateMax:    z.number().nullable().optional(),
}).strict();

/** Provenance for templates imported from upstream platforms. */
const ItemSourceSchema = z.object({
    platform:   z.string().min(1),
    externalId: z.string().min(1),
}).strict();

/** Common fields shared by every item type. */
const BaseItemFields = {
    id:                    z.string().min(1),
    label:                 z.string().min(1).max(100),
    description:           z.string().optional(),
    icon:                  z.string().optional(),
    number:                z.string().optional(),
    required:              z.boolean().optional(),
    isSafety:              z.boolean().optional(),
    defaultRecommendation: z.string().optional(),
    defaultEstimateMin:    z.number().nullable().optional(),
    defaultEstimateMax:    z.number().nullable().optional(),
    attributes:            z.array(ItemAttributeSchema).optional(),
    source:                ItemSourceSchema.nullable().optional(),
} as const;

const RichItemSchema = z.object({
    ...BaseItemFields,
    type:          z.literal('rich'),
    ratingOptions: z.array(z.string().min(1)).min(1),
    tabs:          ItemTabsSchema,
}).strict();

const TextItemSchema = z.object({
    ...BaseItemFields,
    type:    z.literal('text'),
    options: ItemOptionsSchema.optional(),
}).strict();

const BooleanItemSchema = z.object({
    ...BaseItemFields,
    type: z.literal('boolean'),
}).strict();

const TextareaItemSchema = z.object({
    ...BaseItemFields,
    type:    z.literal('textarea'),
    options: ItemOptionsSchema.optional(),
}).strict();

const NumberItemSchema = z.object({
    ...BaseItemFields,
    type:    z.literal('number'),
    options: ItemOptionsSchema.optional(),
}).strict();

const SelectItemSchema = z.object({
    ...BaseItemFields,
    type:    z.literal('select'),
    options: ItemOptionsSchema.optional(),
}).strict();

const MultiSelectItemSchema = z.object({
    ...BaseItemFields,
    type:    z.literal('multi_select'),
    options: ItemOptionsSchema.optional(),
}).strict();

const DateItemSchema = z.object({
    ...BaseItemFields,
    type: z.literal('date'),
}).strict();

const PhotoOnlyItemSchema = z.object({
    ...BaseItemFields,
    type:    z.literal('photo_only'),
    options: ItemOptionsSchema.optional(),
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

// S3-5 — tighten section title to surface obviously-bogus imports
// (e.g. someone pasting an entire paragraph as a "title"). Current
// longest seed section title is 34 chars.
const TemplateSectionSchema = z.object({
    id:         z.string().min(1),
    title:      z.string().min(1).max(50),
    icon:       z.string().optional(),
    identifier: z.string().optional(),
    items:      z.array(TemplateItemSchema),
    // Track E2 (Spectora App.A) — per-section legal disclaimer rendered at
    // the bottom of the section in the published report. Null/empty when
    // unset. Free-form text (≤ 4 KB) so tenants can paste boilerplate.
    disclaimerText:  z.string().max(4000).nullable().optional(),
    // Track E2 — when true, the published report forces a page break BEFORE
    // this section in PDF output.
    alwaysPageBreak: z.boolean().optional(),
}).strict();

const RatingLevelSchema = z.object({
    id:           z.string().min(1),
    label:        z.string().min(1),
    abbreviation: z.string().optional(),
    color:        z.string().optional(),
    severity:     z.enum(['good', 'minor', 'marginal', 'significant']).optional(),
    isDefect:     z.boolean().optional(),
    default:      z.boolean().optional(),
    description:  z.string().optional(),
}).strict();

const RatingSystemSchema = z.object({
    name:           z.string().optional(),
    defaultLevelId: z.string().optional(),
    source:         z.string().nullable().optional(),
    levels:         z.array(RatingLevelSchema),
}).strict();

/**
 * Top-level template schema document. v2 only.
 */
export const TemplateSchemaV2Schema = z.object({
    schemaVersion: z.literal(2),
    sections:      z.array(TemplateSectionSchema),
    ratingSystem:  RatingSystemSchema.optional(),
}).strict();

/**
 * Validation schema for inspection templates (create).
 *
 * Schema must be valid v2. Either pass the parsed object or a JSON string
 * — string form is parsed and re-validated to give a clean error path.
 */
export const CreateTemplateSchema = z.object({
    name: z.string().min(1, 'Template name is required').max(100),
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
    ]),
});

/**
 * Validation schema for updating a template.
 */
export const UpdateTemplateSchema = CreateTemplateSchema.partial();
