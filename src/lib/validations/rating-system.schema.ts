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

/** Bucket the level rolls up into for stats / report cards. */
export const RatingBucketEnum = z.enum(['satisfactory', 'monitor', 'defect', 'na']);
export type RatingBucket = z.infer<typeof RatingBucketEnum>;

/** A single level inside a rating system. */
export const RatingLevelInputSchema = z.object({
    id:       z.string().min(1).max(64).optional(),     // server-assigned UUID when missing
    abbr:     z.string().min(1).max(8),                 // 'Sat', 'I', 'D', 'NI'
    label:    z.string().min(1).max(40),                // 'Satisfactory'
    color:    z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex value like #aabbcc'),
    bucket:   RatingBucketEnum,
    hotkey:   z.string().regex(/^[0-9a-zA-Z]?$/).optional(),
    order:    z.number().int().min(0).max(20).optional(),
}).strict();
export type RatingLevelInput = z.infer<typeof RatingLevelInputSchema>;

/** Persisted level (id + order always present). */
export const RatingLevelSchema = RatingLevelInputSchema.extend({
    id:    z.string().min(1).max(64),
    order: z.number().int().min(0).max(20),
});
export type RatingLevel = z.infer<typeof RatingLevelSchema>;

export const CreateRatingSystemSchema = z.object({
    name:        z.string().min(1).max(60),
    slug:        z.string().regex(/^[a-z0-9-]{2,40}$/, 'Slug must be lowercase alphanumeric + dashes, 2–40 chars'),
    description: z.string().max(200).optional(),
    isDefault:   z.boolean().optional().default(false),
    levels:      z.array(RatingLevelInputSchema).min(2, 'A rating system needs at least 2 levels').max(10),
}).strict();
export type CreateRatingSystemInput = z.infer<typeof CreateRatingSystemSchema>;

export const UpdateRatingSystemSchema = CreateRatingSystemSchema.partial();
export type UpdateRatingSystemInput = z.infer<typeof UpdateRatingSystemSchema>;

export const CloneRatingSystemSchema = z.object({
    name: z.string().min(1).max(60),
    slug: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(),
}).strict();

/** Output shape returned by the API. */
export const RatingSystemResponseSchema = z.object({
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
