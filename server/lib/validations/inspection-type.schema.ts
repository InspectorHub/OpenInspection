import { z } from '@hono/zod-openapi';

// Settings + Library IA — tenant-defined inspection subtypes. `basedOn` is a
// plain-string soft ref to a platform property-subtype slug (no DB FK).
export const CreateInspectionTypeSchema = z.object({
    name:        z.string().min(1).max(100).describe('Inspection subtype label, e.g. "Medical Office".'),
    basedOn:     z.string().max(100).optional().describe('Platform property-subtype slug this is based on.'),
    description: z.string().max(500).optional().describe('Optional details about the subtype.'),
    enabled:     z.boolean().optional().describe('Whether the subtype is selectable.'),
    sortOrder:   z.number().int().nonnegative().default(0).describe('Display order.'),
}).openapi('CreateInspectionType');

// `.partial()` alone keeps `sortOrder`'s `.default(0)`, which would reset the order on every partial update.
export const UpdateInspectionTypeSchema = CreateInspectionTypeSchema.partial().extend({
    sortOrder: CreateInspectionTypeSchema.shape.sortOrder.unwrap().optional().describe('Display order.'),
}).openapi('UpdateInspectionType');

/** A stored inspection subtype, as the list answers it. */
export const InspectionTypeSchema = z.object({
    id:          z.string().describe('Inspection subtype id.'),
    tenantId:    z.string().describe('Id of the company the subtype belongs to.'),
    name:        z.string().describe('Inspection subtype label.'),
    basedOn:     z.string().nullable().describe('Platform property-subtype slug this is based on; null when left blank.'),
    description: z.string().nullable().describe('Optional details about the subtype; null when none.'),
    enabled:     z.boolean().describe('Whether the subtype is selectable.'),
    sortOrder:   z.number().describe('Display order, lowest first.'),
    createdAt:   z.string().describe('When the subtype was created, as an ISO 8601 timestamp.'),
}).openapi('InspectionType');

/** The row a create answers with: the same fields, but the ones the caller left out are absent rather than null. */
export const CreatedInspectionTypeSchema = z.object({
    id:          z.string().describe('Inspection subtype id.'),
    tenantId:    z.string().describe('Id of the company the subtype belongs to.'),
    name:        z.string().describe('Inspection subtype label.'),
    basedOn:     z.string().nullable().optional().describe('Platform property-subtype slug this is based on; absent when none was given.'),
    description: z.string().nullable().optional().describe('Optional details about the subtype; absent when none was given.'),
    enabled:     z.boolean().optional().describe('Whether the subtype is selectable; true unless the caller said otherwise.'),
    sortOrder:   z.number().optional().describe('Display order, lowest first.'),
    createdAt:   z.string().optional().describe('When the subtype was created, as an ISO 8601 timestamp.'),
}).openapi('CreatedInspectionType');
