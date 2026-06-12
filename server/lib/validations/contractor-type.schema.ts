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
    createdAt: z.union([z.string(), z.date(), z.number()]).describe('Creation time.'),
}).openapi('ContractorType');

export const ReorderContractorTypesSchema = z.object({
    ids: z.array(z.string()).min(1).describe('Contractor type ids in the desired order.'),
}).openapi('ReorderContractorTypes');

export type CreateContractorTypeInput = z.infer<typeof CreateContractorTypeSchema>;
export type UpdateContractorTypeInput = z.infer<typeof UpdateContractorTypeSchema>;
