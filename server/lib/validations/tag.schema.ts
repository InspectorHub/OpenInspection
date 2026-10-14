/**
 * Sprint 3 S3-3 — Tag validation schemas.
 *
 * Tags are tenant-scoped library entries that inspectors attach to
 * inspection items via the T hotkey. Internal-only (never on report).
 *
 * Color is optional + free-form so the tag picker can reuse Sprint 1
 * design tokens (slate / amber / rose / indigo / emerald).
 */
import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

const TAG_COLOR_PATTERN = /^[a-z]{3,20}$/;

const TagSchema = z.object({
    id:        z.string().min(1).describe('Tag id.'),
    name:      z.string().min(1).max(40).describe('Tag name, at most 40 characters.'),
    color:     z.string().regex(TAG_COLOR_PATTERN).nullable().optional().describe('Colour token for the tag, or null.'),
    isSeed:    z.boolean().describe('True for built-in tags that ship with the company.'),
    createdAt: z.number().describe('When the tag was created (epoch milliseconds).'),
}).openapi('Tag');
export type TagRecord = z.infer<typeof TagSchema>;

export const CreateTagSchema = z.object({
    name:  z.string().trim().min(1, 'Name is required').max(40, 'Name is too long').describe('Tag name, at most 40 characters.'),
    color: z.string().regex(TAG_COLOR_PATTERN, 'Invalid color token').optional().describe('Colour token for the tag, or null.'),
}).strict().openapi('CreateTag');
export type CreateTagInput = z.infer<typeof CreateTagSchema>;

export const UpdateTagSchema = z.object({
    name:  z.string().trim().min(1).max(40).optional().describe('Tag name, at most 40 characters.'),
    color: z.string().regex(TAG_COLOR_PATTERN).nullable().optional().describe('Colour token for the tag, or null.'),
}).strict().openapi('UpdateTag');
export type UpdateTagInput = z.infer<typeof UpdateTagSchema>;

export const TagListResponseSchema   = createApiResponseSchema(z.array(TagSchema)).openapi('TagListResponse');
export const TagSingleResponseSchema = createApiResponseSchema(TagSchema).openapi('TagSingleResponse');

export const TagDeleteResponseSchema = z.object({
    success: z.literal(true).describe('True when the request succeeded.'),
    data:    z.object({ deleted: z.literal(true).describe('True when the tag was deleted.') }).describe('Response payload.'),
}).openapi('TagDeleteResponse');

/** Empty link/unlink response. */
export const TagLinkResponseSchema   = z.object({
    success: z.literal(true).describe('True when the request succeeded.'),
    data:    z.object({ linked: z.literal(true).describe('True when the tag was attached to the item.') }).describe('Response payload.'),
}).openapi('TagLinkResponse');

export const TagUnlinkResponseSchema = z.object({
    success: z.literal(true).describe('True when the request succeeded.'),
    data:    z.object({ unlinked: z.literal(true).describe('True when the tag was detached from the item.') }).describe('Response payload.'),
}).openapi('TagUnlinkResponse');
