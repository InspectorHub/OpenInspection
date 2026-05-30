// Design System 0520 subsystem B phase 3 — field-level patch schemas.
//
// Used by PATCH /api/inspections/:id/items/:itemId and
// PATCH /api/inspections/:id/property-facts. The `expectedVersion` field
// drives optimistic-concurrency conflict detection — server compares
// against the stored `<field>_v` / `_meta[key].v` counter and returns 409
// + the current value when stale.
import { z } from '@hono/zod-openapi';
import { DEFECT_TRADES, DEFECT_DEADLINES, DEFECT_TIMEFRAMES } from '../../types/defect-fields';

const DefectFieldsValueSchema = z.object({
    cannedId:  z.string().min(1),
    location:  z.string().max(200).optional().nullable(),
    trade:     z.enum(DEFECT_TRADES).optional().nullable(),
    deadline:  z.enum(DEFECT_DEADLINES).optional().nullable(),
    timeframe: z.enum(DEFECT_TIMEFRAMES).optional().nullable(),
});

const CannedToggleValueSchema = z.object({
    tabName:  z.string().min(1),
    cannedId: z.string().min(1),
    included: z.boolean(),
});

const ItemAttributeValueSchema = z.object({
    attributeId: z.string().min(1),
    value:       z.union([z.string(), z.number(), z.boolean(), z.null()]),
});

export const PatchItemFieldSchema = z.object({
    field: z.enum(['rating', 'notes', 'value', 'cannedToggle', 'defectFields', 'itemAttribute'])
        .describe('Which field on the item entry to mutate'),
    value: z.union([
        z.string(), z.number(), z.boolean(), z.array(z.string()), z.null(),
        CannedToggleValueSchema, DefectFieldsValueSchema, ItemAttributeValueSchema,
    ]).describe('Field-typed payload — primitive for simple fields, object for compound'),
    expectedVersion: z.number().int().min(0).describe('Optimistic-concurrency counter'),
    force:           z.boolean().optional().describe('Set true after user resolves a 409'),
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
