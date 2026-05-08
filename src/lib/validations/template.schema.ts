import { z } from '@hono/zod-openapi';

/**
 * Spec 5B — Template schema (v2) validation.
 *
 * The system has not launched in production, so v1 (`type:'rating'` flat
 * items) is rejected outright. Templates MUST be v2: `schemaVersion: 2`,
 * items of type `'rich'` (or `'text'` for free-form notes items), with
 * three tabs of canned comments per `'rich'` item.
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

const RichItemSchema = z.object({
    id:            z.string().min(1),
    label:         z.string().min(1),
    type:          z.literal('rich'),
    ratingOptions: z.array(z.string().min(1)).min(1),
    tabs:          ItemTabsSchema,
    icon:          z.string().optional(),
    number:        z.string().optional(),
}).strict();

const TextItemSchema = z.object({
    id:     z.string().min(1),
    label:  z.string().min(1),
    type:   z.literal('text'),
    icon:   z.string().optional(),
    number: z.string().optional(),
}).strict();

const TemplateItemSchema = z.discriminatedUnion('type', [RichItemSchema, TextItemSchema]);

const TemplateSectionSchema = z.object({
    id:    z.string().min(1),
    title: z.string().min(1),
    icon:  z.string().optional(),
    items: z.array(TemplateItemSchema),
    // Track E2 (Spectora App.A) — per-section legal disclaimer rendered at
    // the bottom of the section in the published report. Null/empty when
    // unset. Free-form text (≤ 4 KB) so tenants can paste boilerplate.
    disclaimerText: z.string().max(4000).nullable().optional(),
    // Track E2 — when true, the published report forces a page break BEFORE
    // this section in PDF output. Used for cover-letter style sections that
    // must start on a fresh sheet. Defaults to false (the existing CSS
    // already breaks per-section by default — this flag is an explicit
    // marker so future "no-break" overrides have a clean signal to honor).
    alwaysPageBreak: z.boolean().optional(),
}).strict();

const RatingLevelSchema = z.object({
    id:           z.string().min(1),
    label:        z.string().min(1),
    abbreviation: z.string().optional(),
    color:        z.string().optional(),
    severity:     z.enum(['good', 'minor', 'marginal', 'significant']).optional(),
    isDefect:     z.boolean().optional(),
    description:  z.string().optional(),
}).strict();

/**
 * Top-level template schema document. v2 only.
 */
export const TemplateSchemaV2Schema = z.object({
    schemaVersion: z.literal(2),
    sections:      z.array(TemplateSectionSchema),
    ratingSystem:  z.object({ levels: z.array(RatingLevelSchema) }).optional(),
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
