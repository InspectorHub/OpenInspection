// Design System 0520 subsystem B phase 3 — field-level patch schemas.
//
// Used by PATCH /api/inspections/:id/items/:itemId and
// PATCH /api/inspections/:id/property-facts. The `expectedVersion` field
// drives optimistic-concurrency conflict detection — server compares
// against the stored `<field>_v` / `_meta[key].v` counter and returns 409
// + the current value when stale.
import { z } from '@hono/zod-openapi';

export const PatchItemFieldSchema = z.object({
    field:           z.enum(['rating', 'notes', 'value']).describe('TODO describe field field for the OpenInspection MCP integration'),
    value:           z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]).describe('TODO describe value field for the OpenInspection MCP integration'),
    expectedVersion: z.number().int().min(0).describe('TODO describe expectedVersion field for the OpenInspection MCP integration'),
    /** Set true after the user resolves a 409 via ConflictModal — bypasses
     *  the version check for that single retry. */
    force:           z.boolean().optional().describe('TODO describe force field for the OpenInspection MCP integration'),
    /** Section ID for composite finding key (_default:sectionId:itemId). */
    sectionId:       z.string().min(1).optional().describe('Section ID for composite finding key'),
}).openapi('PatchItemField');

export const PatchPropertyFactSchema = z.object({
    key:             z.string().min(1).max(64).describe('TODO describe key field for the OpenInspection MCP integration'),
    value:           z.union([z.string(), z.number(), z.boolean(), z.null()]).describe('TODO describe value field for the OpenInspection MCP integration'),
    expectedVersion: z.number().int().min(0).describe('TODO describe expectedVersion field for the OpenInspection MCP integration'),
    force:           z.boolean().optional().describe('TODO describe force field for the OpenInspection MCP integration'),
}).openapi('PatchPropertyFact');

export type PatchItemFieldInput    = z.infer<typeof PatchItemFieldSchema>;
export type PatchPropertyFactInput = z.infer<typeof PatchPropertyFactSchema>;
