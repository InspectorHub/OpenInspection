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

export const UpdateInspectionTypeSchema = CreateInspectionTypeSchema.partial().openapi('UpdateInspectionType');
