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
    id:        z.string().min(1).describe('TODO describe id field for the OpenInspection MCP integration'),
    name:      z.string().min(1).max(40).describe('TODO describe name field for the OpenInspection MCP integration'),
    color:     z.string().regex(TAG_COLOR_PATTERN).nullable().optional().describe('TODO describe color field for the OpenInspection MCP integration'),
    isSeed:    z.boolean().describe('TODO describe isSeed field for the OpenInspection MCP integration'),
    createdAt: z.number().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
}).openapi('Tag');
export type TagRecord = z.infer<typeof TagSchema>;

export const CreateTagSchema = z.object({
    name:  z.string().trim().min(1, 'Name is required').max(40, 'Name is too long').describe('TODO describe name field for the OpenInspection MCP integration'),
    color: z.string().regex(TAG_COLOR_PATTERN, 'Invalid color token').optional().describe('TODO describe color field for the OpenInspection MCP integration'),
}).strict().openapi('CreateTag');
export type CreateTagInput = z.infer<typeof CreateTagSchema>;

export const UpdateTagSchema = z.object({
    name:  z.string().trim().min(1).max(40).optional().describe('TODO describe name field for the OpenInspection MCP integration'),
    color: z.string().regex(TAG_COLOR_PATTERN).nullable().optional().describe('TODO describe color field for the OpenInspection MCP integration'),
}).strict().openapi('UpdateTag');
export type UpdateTagInput = z.infer<typeof UpdateTagSchema>;

export const TagListResponseSchema   = createApiResponseSchema(z.array(TagSchema)).openapi('TagListResponse');
export const TagSingleResponseSchema = createApiResponseSchema(TagSchema).openapi('TagSingleResponse');

export const TagDeleteResponseSchema = z.object({
    success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
    data:    z.object({ deleted: z.literal(true).describe('TODO describe deleted field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
}).openapi('TagDeleteResponse');

/** Empty link/unlink response. */
export const TagLinkResponseSchema   = z.object({
    success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
    data:    z.object({ linked: z.literal(true).describe('TODO describe linked field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
}).openapi('TagLinkResponse');

export const TagUnlinkResponseSchema = z.object({
    success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
    data:    z.object({ unlinked: z.literal(true).describe('TODO describe unlinked field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
}).openapi('TagUnlinkResponse');
