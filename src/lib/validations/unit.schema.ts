// Design System 0520 subsystem D phase 1 task 1.3 — UnitTree Zod schemas.
// Used by POST / PATCH / move routes on /api/inspections/:id/units.
import { z } from '@hono/zod-openapi';

export const CreateUnitSchema = z.object({
    parentUnitId: z.string().min(1).nullable().describe('TODO describe parentUnitId field for the OpenInspection MCP integration'),
    kind:         z.enum(['building', 'floor', 'unit']).describe('TODO describe kind field for the OpenInspection MCP integration'),
    type:         z.enum(['unit', 'common']).default('unit').describe('Purpose: regular unit or common area'),
    name:         z.string().min(1).max(80).describe('TODO describe name field for the OpenInspection MCP integration'),
}).openapi('CreateUnit');

export const UpdateUnitSchema = z.object({
    name:      z.string().min(1).max(80).optional().describe('TODO describe name field for the OpenInspection MCP integration'),
    sortOrder: z.number().int().min(0).optional().describe('TODO describe sortOrder field for the OpenInspection MCP integration'),
}).openapi('UpdateUnit');

export const MoveUnitSchema = z.object({
    newParentUnitId: z.string().min(1).nullable().describe('TODO describe newParentUnitId field for the OpenInspection MCP integration'),
    newSortOrder:    z.number().int().min(0).describe('TODO describe newSortOrder field for the OpenInspection MCP integration'),
}).openapi('MoveUnit');

export type CreateUnitInput = z.infer<typeof CreateUnitSchema>;
export type UpdateUnitInput = z.infer<typeof UpdateUnitSchema>;
export type MoveUnitInput   = z.infer<typeof MoveUnitSchema>;
