// Design System 0520 subsystem D phase 1 task 1.3 — UnitTree Zod schemas.
// Used by POST / PATCH / move routes on /api/inspections/:id/units.
import { z } from '@hono/zod-openapi';

export const CreateUnitSchema = z.object({
    parentUnitId: z.string().min(1).nullable().describe('Id of the node to create this one under; null places it at the top level.'),
    kind:         z.enum(['building', 'floor', 'unit']).describe('Level of the node: building, floor or unit.'),
    type:         z.enum(['unit', 'common']).default('unit').describe('Purpose: regular unit or common area'),
    name:         z.string().min(1).max(80).describe('Display name, which must be unique among siblings under the same parent.'),
}).openapi('CreateUnit');

export const UpdateUnitSchema = z.object({
    name:      z.string().min(1).max(80).optional().describe('New display name for the unit.'),
    sortOrder: z.number().int().min(0).optional().describe('New position among siblings; lower values come first.'),
}).openapi('UpdateUnit');

export const MoveUnitSchema = z.object({
    newParentUnitId: z.string().min(1).nullable().describe('Id of the node to move the unit under; null moves it to the top level.'),
    newSortOrder:    z.number().int().min(0).describe('Position among the new siblings; lower values come first.'),
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
