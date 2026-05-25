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
    id:      z.string().min(1).describe('TODO describe id field for the OpenInspection MCP integration'),
    title:   z.string().min(1).describe('TODO describe title field for the OpenInspection MCP integration'),
    comment: z.string().describe('TODO describe comment field for the OpenInspection MCP integration'),
    default: z.boolean().describe('TODO describe default field for the OpenInspection MCP integration'),
}).strict();

const CannedDefectSchema = z.object({
    id:       z.string().min(1).describe('TODO describe id field for the OpenInspection MCP integration'),
    title:    z.string().min(1).describe('TODO describe title field for the OpenInspection MCP integration'),
    category: DefectCategoryEnum.describe('TODO describe category field for the OpenInspection MCP integration'),
    location: z.string().describe('TODO describe location field for the OpenInspection MCP integration'),
    comment:  z.string().describe('TODO describe comment field for the OpenInspection MCP integration'),
    photos:   z.array(z.string()).describe('TODO describe photos field for the OpenInspection MCP integration'),
    default:  z.boolean().describe('TODO describe default field for the OpenInspection MCP integration'),
}).strict();

const ItemTabsSchema = z.object({
    information: z.array(CannedInfoCommentSchema).describe('TODO describe information field for the OpenInspection MCP integration'),
    limitations: z.array(CannedInfoCommentSchema).describe('TODO describe limitations field for the OpenInspection MCP integration'),
    defects:     z.array(CannedDefectSchema).describe('TODO describe defects field for the OpenInspection MCP integration'),
}).strict();

/** Per-item sub-properties — only meaningful on the non-rich types. */
const ItemOptionsSchema = z.object({
    min:         z.number().nullable().optional().describe('TODO describe min field for the OpenInspection MCP integration'),
    max:         z.number().nullable().optional().describe('TODO describe max field for the OpenInspection MCP integration'),
    unit:        z.string().optional().describe('TODO describe unit field for the OpenInspection MCP integration'),
    step:        z.number().nullable().optional().describe('TODO describe step field for the OpenInspection MCP integration'),
    placeholder: z.string().optional().describe('TODO describe placeholder field for the OpenInspection MCP integration'),
    maxLength:   z.number().nullable().optional().describe('TODO describe maxLength field for the OpenInspection MCP integration'),
    choices:     z.array(z.string()).optional().describe('TODO describe choices field for the OpenInspection MCP integration'),
    minPhotos:   z.number().nullable().optional().describe('TODO describe minPhotos field for the OpenInspection MCP integration'),
}).strict();

/** Optional sub-fields nested under an item, e.g. tonnage on an HVAC unit. */
const ItemAttributeTypeEnum = z.enum(['boolean', 'text', 'number', 'select', 'multi_select', 'date']);
const ItemAttributeSchema = z.object({
    id:             z.string().min(1).describe('TODO describe id field for the OpenInspection MCP integration'),
    name:           z.string().min(1).describe('TODO describe name field for the OpenInspection MCP integration'),
    type:           ItemAttributeTypeEnum.describe('TODO describe type field for the OpenInspection MCP integration'),
    choices:        z.array(z.string()).optional().describe('TODO describe choices field for the OpenInspection MCP integration'),
    unit:           z.string().optional().describe('TODO describe unit field for the OpenInspection MCP integration'),
    required:       z.boolean().optional().describe('TODO describe required field for the OpenInspection MCP integration'),
    isSafety:       z.boolean().optional().describe('TODO describe isSafety field for the OpenInspection MCP integration'),
    isDefect:       z.boolean().optional().describe('TODO describe isDefect field for the OpenInspection MCP integration'),
    recommendation: z.string().nullable().optional().describe('TODO describe recommendation field for the OpenInspection MCP integration'),
    estimateMin:    z.number().nullable().optional().describe('TODO describe estimateMin field for the OpenInspection MCP integration'),
    estimateMax:    z.number().nullable().optional().describe('TODO describe estimateMax field for the OpenInspection MCP integration'),
}).strict();

/** Provenance for templates imported from upstream platforms. */
const ItemSourceSchema = z.object({
    platform:   z.string().min(1).describe('TODO describe platform field for the OpenInspection MCP integration'),
    externalId: z.string().min(1).describe('TODO describe externalId field for the OpenInspection MCP integration'),
}).strict();

/** Common fields shared by every item type. */
const BaseItemFields = {
    id:                    z.string().min(1).describe('TODO describe id field for the OpenInspection MCP integration'),
    label:                 z.string().min(1).max(100).describe('TODO describe label field for the OpenInspection MCP integration'),
    description:           z.string().optional().describe('TODO describe description field for the OpenInspection MCP integration'),
    icon:                  z.string().optional().describe('TODO describe icon field for the OpenInspection MCP integration'),
    number:                z.string().optional().describe('TODO describe number field for the OpenInspection MCP integration'),
    required:              z.boolean().optional().describe('TODO describe required field for the OpenInspection MCP integration'),
    isSafety:              z.boolean().optional().describe('TODO describe isSafety field for the OpenInspection MCP integration'),
    defaultRecommendation: z.string().optional().describe('TODO describe defaultRecommendation field for the OpenInspection MCP integration'),
    defaultEstimateMin:    z.number().nullable().optional().describe('TODO describe defaultEstimateMin field for the OpenInspection MCP integration'),
    defaultEstimateMax:    z.number().nullable().optional().describe('TODO describe defaultEstimateMax field for the OpenInspection MCP integration'),
    attributes:            z.array(ItemAttributeSchema).optional().describe('TODO describe attributes field for the OpenInspection MCP integration'),
    source:                ItemSourceSchema.nullable().optional().describe('TODO describe source field for the OpenInspection MCP integration'),
} as const;

const RichItemSchema = z.object({
    ...BaseItemFields,
    type:          z.literal('rich').describe('TODO describe type field for the OpenInspection MCP integration'),
    ratingOptions: z.array(z.string().min(1)).min(1).describe('TODO describe ratingOptions field for the OpenInspection MCP integration'),
    tabs:          ItemTabsSchema.describe('TODO describe tabs field for the OpenInspection MCP integration'),
}).strict();

const TextItemSchema = z.object({
    ...BaseItemFields,
    type:    z.literal('text').describe('TODO describe type field for the OpenInspection MCP integration'),
    options: ItemOptionsSchema.optional().describe('TODO describe options field for the OpenInspection MCP integration'),
}).strict();

const BooleanItemSchema = z.object({
    ...BaseItemFields,
    type: z.literal('boolean').describe('TODO describe type field for the OpenInspection MCP integration'),
}).strict();

const TextareaItemSchema = z.object({
    ...BaseItemFields,
    type:    z.literal('textarea').describe('TODO describe type field for the OpenInspection MCP integration'),
    options: ItemOptionsSchema.optional().describe('TODO describe options field for the OpenInspection MCP integration'),
}).strict();

const NumberItemSchema = z.object({
    ...BaseItemFields,
    type:    z.literal('number').describe('TODO describe type field for the OpenInspection MCP integration'),
    options: ItemOptionsSchema.optional().describe('TODO describe options field for the OpenInspection MCP integration'),
}).strict();

const SelectItemSchema = z.object({
    ...BaseItemFields,
    type:    z.literal('select').describe('TODO describe type field for the OpenInspection MCP integration'),
    options: ItemOptionsSchema.optional().describe('TODO describe options field for the OpenInspection MCP integration'),
}).strict();

const MultiSelectItemSchema = z.object({
    ...BaseItemFields,
    type:    z.literal('multi_select').describe('TODO describe type field for the OpenInspection MCP integration'),
    options: ItemOptionsSchema.optional().describe('TODO describe options field for the OpenInspection MCP integration'),
}).strict();

const DateItemSchema = z.object({
    ...BaseItemFields,
    type: z.literal('date').describe('TODO describe type field for the OpenInspection MCP integration'),
}).strict();

const PhotoOnlyItemSchema = z.object({
    ...BaseItemFields,
    type:    z.literal('photo_only').describe('TODO describe type field for the OpenInspection MCP integration'),
    options: ItemOptionsSchema.optional().describe('TODO describe options field for the OpenInspection MCP integration'),
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
    id:         z.string().min(1).describe('TODO describe id field for the OpenInspection MCP integration'),
    title:      z.string().min(1).max(50).describe('TODO describe title field for the OpenInspection MCP integration'),
    icon:       z.string().optional().describe('TODO describe icon field for the OpenInspection MCP integration'),
    identifier: z.string().optional().describe('TODO describe identifier field for the OpenInspection MCP integration'),
    items:      z.array(TemplateItemSchema).describe('TODO describe items field for the OpenInspection MCP integration'),
    // Track E2 (Spectora App.A) — per-section legal disclaimer rendered at
    // the bottom of the section in the published report. Null/empty when
    // unset. Free-form text (≤ 4 KB) so tenants can paste boilerplate.
    disclaimerText:  z.string().max(4000).nullable().optional().describe('TODO describe disclaimerText field for the OpenInspection MCP integration'),
    // Track E2 — when true, the published report forces a page break BEFORE
    // this section in PDF output.
    alwaysPageBreak: z.boolean().optional().describe('TODO describe alwaysPageBreak field for the OpenInspection MCP integration'),
    // Provenance from upstream platform imports (e.g. Spectora). The editor
    // surfaces this as a small colored dot next to the section title so
    // imported sections are visually distinguishable.
    source:          ItemSourceSchema.nullable().optional().describe('TODO describe source field for the OpenInspection MCP integration'),
}).strict();

const RatingLevelSchema = z.object({
    id:           z.string().min(1).describe('TODO describe id field for the OpenInspection MCP integration'),
    label:        z.string().min(1).describe('TODO describe label field for the OpenInspection MCP integration'),
    abbreviation: z.string().optional().describe('TODO describe abbreviation field for the OpenInspection MCP integration'),
    color:        z.string().optional().describe('TODO describe color field for the OpenInspection MCP integration'),
    severity:     z.enum(['good', 'minor', 'marginal', 'significant']).optional().describe('TODO describe severity field for the OpenInspection MCP integration'),
    isDefect:     z.boolean().optional().describe('TODO describe isDefect field for the OpenInspection MCP integration'),
    default:      z.boolean().optional().describe('TODO describe default field for the OpenInspection MCP integration'),
    description:  z.string().optional().describe('TODO describe description field for the OpenInspection MCP integration'),
}).strict();

const RatingSystemSchema = z.object({
    name:           z.string().optional().describe('TODO describe name field for the OpenInspection MCP integration'),
    defaultLevelId: z.string().optional().describe('TODO describe defaultLevelId field for the OpenInspection MCP integration'),
    source:         z.string().nullable().optional().describe('TODO describe source field for the OpenInspection MCP integration'),
    levels:         z.array(RatingLevelSchema).describe('TODO describe levels field for the OpenInspection MCP integration'),
}).strict();

/**
 * Top-level template schema document. v2 only.
 */
export const TemplateSchemaV2Schema = z.object({
    schemaVersion: z.literal(2).describe('TODO describe schemaVersion field for the OpenInspection MCP integration'),
    sections:      z.array(TemplateSectionSchema).describe('TODO describe sections field for the OpenInspection MCP integration'),
    ratingSystem:  RatingSystemSchema.optional().describe('TODO describe ratingSystem field for the OpenInspection MCP integration'),
}).strict();

/**
 * Validation schema for inspection templates (create).
 *
 * Schema must be valid v2. Either pass the parsed object or a JSON string
 * — string form is parsed and re-validated to give a clean error path.
 */
export const CreateTemplateSchema = z.object({
    name: z.string().min(1, 'Template name is required').max(100).describe('TODO describe name field for the OpenInspection MCP integration'),
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
    ]).describe('TODO describe schema field for the OpenInspection MCP integration'),
});

/**
 * Validation schema for updating a template.
 */
export const UpdateTemplateSchema = CreateTemplateSchema.partial();
