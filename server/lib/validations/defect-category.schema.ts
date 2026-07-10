import { z } from '@hono/zod-openapi';

export const CreateDefectCategorySchema = z.object({
    name:          z.string().min(1).max(60).describe('Category label, e.g. "Safety".'),
    color:         z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex value like #aabbcc').optional().default('#6b7280').describe('Swatch color for the category chip.'),
    drivesSummary: z.boolean().optional().default(true).describe('When true, defects in this category are pulled into the report Summary.'),
    sortOrder:     z.number().int().min(0).max(999).optional().describe('Display order.'),
}).strict().openapi('CreateDefectCategory');

export const UpdateDefectCategorySchema = CreateDefectCategorySchema.partial().openapi('UpdateDefectCategory');

export const DefectCategoryResponseSchema = z.object({
    id:            z.string().describe('Defect category id.'),
    name:          z.string().describe('Category label.'),
    color:         z.string().describe('Swatch color.'),
    drivesSummary: z.boolean().describe('Whether defects in this category count toward the report Summary.'),
    sortOrder:     z.number().int().describe('Display order.'),
    isSeed:        z.boolean().describe('True for the built-in maintenance/recommendation/safety rows (not user-deletable).'),
}).openapi('DefectCategory');

export type CreateDefectCategoryInput = z.infer<typeof CreateDefectCategorySchema>;
export type UpdateDefectCategoryInput = z.infer<typeof UpdateDefectCategorySchema>;
