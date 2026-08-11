import { z } from '@hono/zod-openapi';

export const CreateContractorTypeSchema = z.object({
    name:      z.string().min(1).max(100).describe('Contractor type label, e.g. "Licensed Electrician".'),
    sortOrder: z.number().int().nonnegative().optional().describe('Display order.'),
}).openapi('CreateContractorType');

export const UpdateContractorTypeSchema = CreateContractorTypeSchema.partial().openapi('UpdateContractorType');

export const ContractorTypeSchema = z.object({
    id:        z.string().describe('Contractor type id.'),
    tenantId:  z.string().describe('Owning tenant.'),
    name:      z.string().describe('Label.'),
    sortOrder: z.number().int().describe('Display order.'),
    tradeSlug: z.string().nullable().describe('Canonical DEFECT_TRADES slug this type maps to, or null for a tenant-created type with no counterpart in the vocabulary. Stable across renames — it is what survives a tenant renaming the display label.'),
    createdAt: z.union([z.string(), z.date(), z.number()]).describe('Creation time.'),
}).openapi('ContractorType');

export const ReorderContractorTypesSchema = z.object({
    ids: z.array(z.string()).min(1).describe('Contractor type ids in the desired order.'),
}).openapi('ReorderContractorTypes');

export type CreateContractorTypeInput = z.infer<typeof CreateContractorTypeSchema>;
export type UpdateContractorTypeInput = z.infer<typeof UpdateContractorTypeSchema>;
