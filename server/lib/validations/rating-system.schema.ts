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
    id:            z.string().min(1).max(64).optional().describe('TODO describe id field for the OpenInspection MCP integration'),     // server-assigned UUID when missing
    abbreviation:  z.string().min(1).max(8).describe('TODO describe abbreviation field for the OpenInspection MCP integration'),                 // 'Sat', 'I', 'D', 'NI'
    label:         z.string().min(1).max(40).describe('TODO describe label field for the OpenInspection MCP integration'),                // 'Satisfactory'
    color:         z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex value like #aabbcc').describe('TODO describe color field for the OpenInspection MCP integration'),
    severity:      SeverityEnum.describe('TODO describe severity field for the OpenInspection MCP integration'),
    isDefect:      z.boolean().optional().default(false).describe('TODO describe isDefect field for the OpenInspection MCP integration'),
    pausesAdvance: z.boolean().optional().describe('TODO describe pausesAdvance field for the OpenInspection MCP integration'),
    hotkey:        z.string().regex(/^[0-9a-zA-Z]?$/).optional().describe('TODO describe hotkey field for the OpenInspection MCP integration'),
    order:         z.number().int().min(0).max(20).optional().describe('TODO describe order field for the OpenInspection MCP integration'),
}).strict();
export type RatingLevelInput = z.infer<typeof RatingLevelInputSchema>;

/** Persisted level (id + order always present). */
const RatingLevelSchema = RatingLevelInputSchema.extend({
    id:    z.string().min(1).max(64).describe('TODO describe id field for the OpenInspection MCP integration'),
    order: z.number().int().min(0).max(20).describe('TODO describe order field for the OpenInspection MCP integration'),
});
export type RatingLevel = z.infer<typeof RatingLevelSchema>;

export const CreateRatingSystemSchema = z.object({
    name:        z.string().min(1).max(60).describe('TODO describe name field for the OpenInspection MCP integration'),
    slug:        z.string().regex(/^[a-z0-9-]{2,40}$/, 'Slug must be lowercase alphanumeric + dashes, 2–40 chars').describe('TODO describe slug field for the OpenInspection MCP integration'),
    description: z.string().max(200).optional().describe('TODO describe description field for the OpenInspection MCP integration'),
    isDefault:   z.boolean().optional().default(false).describe('TODO describe isDefault field for the OpenInspection MCP integration'),
    levels:      z.array(RatingLevelInputSchema).min(2, 'A rating system needs at least 2 levels').max(10).describe('TODO describe levels field for the OpenInspection MCP integration'),
}).strict();
export type CreateRatingSystemInput = z.infer<typeof CreateRatingSystemSchema>;

export const UpdateRatingSystemSchema = CreateRatingSystemSchema.partial();
export type UpdateRatingSystemInput = z.infer<typeof UpdateRatingSystemSchema>;

export const CloneRatingSystemSchema = z.object({
    name: z.string().min(1).max(60).describe('TODO describe name field for the OpenInspection MCP integration'),
    slug: z.string().regex(/^[a-z0-9-]{2,40}$/).optional().describe('TODO describe slug field for the OpenInspection MCP integration'),
}).strict();

/** Output shape returned by the API. */
const RatingSystemResponseSchema = z.object({
    id:          z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    name:        z.string().describe('TODO describe name field for the OpenInspection MCP integration'),
    slug:        z.string().describe('TODO describe slug field for the OpenInspection MCP integration'),
    description: z.string().nullable().describe('TODO describe description field for the OpenInspection MCP integration'),
    isDefault:   z.boolean().describe('TODO describe isDefault field for the OpenInspection MCP integration'),
    isSeed:      z.boolean().describe('TODO describe isSeed field for the OpenInspection MCP integration'),
    levels:      z.array(RatingLevelSchema).describe('TODO describe levels field for the OpenInspection MCP integration'),
    createdAt:   z.number().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
    updatedAt:   z.number().describe('TODO describe updatedAt field for the OpenInspection MCP integration'),
});

export const RatingSystemListResponseSchema = z.object({
    success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
    data:    z.array(RatingSystemResponseSchema).describe('TODO describe data field for the OpenInspection MCP integration'),
});

export const RatingSystemSingleResponseSchema = z.object({
    success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
    data:    RatingSystemResponseSchema.describe('TODO describe data field for the OpenInspection MCP integration'),
});
