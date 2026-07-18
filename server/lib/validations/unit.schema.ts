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

// Commercial PCA Phase U — bulk create N units (floors×stacks or CSV) under one
// parent node. parentUnitId null = top-level (single-building inspections).
export const BulkCreateUnitsSchema = z.discriminatedUnion('mode', [
    z.object({
        mode:         z.literal('floors_stacks'),
        floors:       z.array(z.number().int()).min(1).max(200),
        stacks:       z.number().int().min(1).max(200),
        startAt:      z.number().int().min(0).optional(),
        parentUnitId: z.string().min(1).nullish(),
    }),
    z.object({
        mode:         z.literal('csv'),
        csv:          z.string().min(1).max(20000),
        parentUnitId: z.string().min(1).nullish(),
    }),
]).openapi('BulkCreateUnits');

// Commercial PCA Phase U (Batch C2a) — switch an inspection's unit-inspection
// mode. `per_unit` promotes location tags into first-class unit rows + re-keys
// findings; `tagged` is the LOSSY reverse (drops the unit rows + matrix). The
// UI gates the lossy direction behind a confirm modal (Batch C2b); the endpoint
// itself just executes whichever mode the caller asks for.
export const UnitModeSwitchSchema = z.object({
    mode: z.enum(['tagged', 'per_unit']).describe('Target unit-inspection mode: "per_unit" (promote to per-unit matrix) or "tagged" (flatten back to common scope + location tags).'),
}).openapi('UnitModeSwitch');
