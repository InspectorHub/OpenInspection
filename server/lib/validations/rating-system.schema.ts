/**
 * Sprint 2 S2-1 — Rating System validation.
 *
 * A rating system is a tenant-scoped library entry that defines the
 * ordered list of rating levels an inspector can apply to inspection items.
 * Templates pick exactly one rating system; inspections snapshot the levels
 * at creation time so editing the source system later never mutates an
 * existing inspection.
 */
import { z } from '@hono/zod-openapi';

/** The single severity vocabulary shared by rating levels AND comments (spec §4.F, §9 #1). */
const SeverityEnum = z.enum(['good', 'marginal', 'significant', 'minor']);
export type Severity = z.infer<typeof SeverityEnum>;

/** A single level inside a rating system. */
const RatingLevelInputSchema = z.object({
    id:            z.string().min(1).max(64).optional().describe('Level id. Leave out to have the server assign one.'),     // server-assigned UUID when missing
    abbreviation:  z.string().min(1).max(8).describe('Short code shown on the rating button, for example Sat or D.'),                 // 'Sat', 'I', 'D', 'NI'
    label:         z.string().min(1).max(40).describe('Full name of the rating level, for example Satisfactory.'),                // 'Satisfactory'
    color:         z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex value like #aabbcc').describe('Level colour as a six digit hex value such as #aabbcc.'),
    severity:      SeverityEnum.describe('Severity this level stands for, shared with canned comments.'),
    isDefect:      z.boolean().optional().default(false).describe('Whether this level counts as a defect.'),
    pausesAdvance: z.boolean().optional().describe('When true the editor stays on the item and moves focus to its notes after this level is applied, instead of auto-advancing.'),
    hotkey:        z.string().regex(/^[0-9a-zA-Z]?$/).optional().describe('Single keyboard key that selects this level in the inspection editor; empty for none.'),
    order:         z.number().int().min(0).max(20).optional().describe('Display position of the level. Defaults to its position in the submitted list.'),
}).strict();
export type RatingLevelInput = z.infer<typeof RatingLevelInputSchema>;

/** Persisted level (id + order always present). */
const RatingLevelSchema = RatingLevelInputSchema.extend({
    id:    z.string().min(1).max(64).describe('TODO describe id field for the OpenInspection MCP integration'),
    order: z.number().int().min(0).max(20).describe('TODO describe order field for the OpenInspection MCP integration'),
});
export type RatingLevel = z.infer<typeof RatingLevelSchema>;

export const CreateRatingSystemSchema = z.object({
    name:        z.string().min(1).max(60).describe('Display name of the rating system.'),
    slug:        z.string().regex(/^[a-z0-9-]{2,40}$/, 'Slug must be lowercase alphanumeric + dashes, 2–40 chars').describe('Unique identifier within the company, lowercase letters, digits and dashes.'),
    description: z.string().max(200).optional().describe('Short explanation of when to use this rating system.'),
    isDefault:   z.boolean().optional().default(false).describe('Make this the company default; the flag is cleared on every other system.'),
    levels:      z.array(RatingLevelInputSchema).min(2, 'A rating system needs at least 2 levels').max(10).describe('Ordered rating levels inspectors choose from. Updating replaces the whole list.'),
}).strict();
export type CreateRatingSystemInput = z.infer<typeof CreateRatingSystemSchema>;

export const UpdateRatingSystemSchema = CreateRatingSystemSchema.partial();
export type UpdateRatingSystemInput = z.infer<typeof UpdateRatingSystemSchema>;

export const CloneRatingSystemSchema = z.object({
    name: z.string().min(1).max(60).describe('Name of the new copy.'),
    slug: z.string().regex(/^[a-z0-9-]{2,40}$/).optional().describe('Slug of the new copy. Generated from the source slug when left out.'),
}).strict();

/** Output shape returned by the API. */
const RatingSystemResponseSchema = z.object({
    id:          z.string(),
    name:        z.string(),
    slug:        z.string(),
    description: z.string().nullable(),
    isDefault:   z.boolean(),
    isSeed:      z.boolean(),
    levels:      z.array(RatingLevelSchema),
    createdAt:   z.number(),
    updatedAt:   z.number(),
});

export const RatingSystemListResponseSchema = z.object({
    success: z.literal(true),
    data:    z.array(RatingSystemResponseSchema),
});

export const RatingSystemSingleResponseSchema = z.object({
    success: z.literal(true),
    data:    RatingSystemResponseSchema,
});
