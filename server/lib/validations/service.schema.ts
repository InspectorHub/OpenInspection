import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

const ServiceSchema = z.object({
    id:              z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    tenantId:        z.string().describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    name:            z.string().describe('TODO describe name field for the OpenInspection MCP integration'),
    description:     z.string().nullable().describe('TODO describe description field for the OpenInspection MCP integration'),
    price:           z.number().int().describe('TODO describe price field for the OpenInspection MCP integration'),
    durationMinutes: z.number().int().nullable().describe('TODO describe durationMinutes field for the OpenInspection MCP integration'),
    templateId:      z.string().nullable().describe('TODO describe templateId field for the OpenInspection MCP integration'),
    agreementId:     z.string().nullable().describe('TODO describe agreementId field for the OpenInspection MCP integration'),
    active:          z.boolean().describe('TODO describe active field for the OpenInspection MCP integration'),
    sortOrder:       z.number().int().describe('TODO describe sortOrder field for the OpenInspection MCP integration'),
    createdAt:       z.string().nullable().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
}).openapi('Service');

export const CreateServiceSchema = z.object({
    name:            z.string().min(1).max(200).describe('TODO describe name field for the OpenInspection MCP integration'),
    description:     z.string().max(1000).optional().describe('TODO describe description field for the OpenInspection MCP integration'),
    price:           z.number().int().min(0).describe('TODO describe price field for the OpenInspection MCP integration'),
    durationMinutes: z.number().int().min(0).optional().describe('TODO describe durationMinutes field for the OpenInspection MCP integration'),
    templateId:      z.string().optional().describe('TODO describe templateId field for the OpenInspection MCP integration'),
    agreementId:     z.string().optional().describe('TODO describe agreementId field for the OpenInspection MCP integration'),
    sortOrder:       z.number().int().optional().describe('TODO describe sortOrder field for the OpenInspection MCP integration'),
}).openapi('CreateService');

export const UpdateServiceSchema = CreateServiceSchema.partial().extend({
    active: z.boolean().optional().describe('TODO describe active field for the OpenInspection MCP integration'),
}).openapi('UpdateService');

export const CreateDiscountCodeSchema = z.object({
    code:      z.string().min(1).max(50).describe('TODO describe code field for the OpenInspection MCP integration'),
    type:      z.enum(['fixed', 'percent']).describe('TODO describe type field for the OpenInspection MCP integration'),
    value:     z.number().int().min(1).describe('TODO describe value field for the OpenInspection MCP integration'),
    maxUses:   z.number().int().min(1).optional().describe('TODO describe maxUses field for the OpenInspection MCP integration'),
    expiresAt: z.string().datetime().optional().describe('TODO describe expiresAt field for the OpenInspection MCP integration'),
}).openapi('CreateDiscountCode');

export const UpdateDiscountCodeSchema = z.object({
    code:      z.string().min(1).max(50).optional().describe('TODO describe code field for the OpenInspection MCP integration'),
    type:      z.enum(['fixed', 'percent']).optional().describe('TODO describe type field for the OpenInspection MCP integration'),
    value:     z.number().int().min(0).optional().describe('TODO describe value field for the OpenInspection MCP integration'),
    maxUses:   z.number().int().min(0).nullable().optional().describe('TODO describe maxUses field for the OpenInspection MCP integration'),
    expiresAt: z.string().nullable().optional().describe('TODO describe expiresAt field for the OpenInspection MCP integration'),
    active:    z.boolean().optional().describe('TODO describe active field for the OpenInspection MCP integration'),
}).openapi('UpdateDiscountCode');

export const ValidateDiscountSchema = z.object({
    code:     z.string().min(1).describe('TODO describe code field for the OpenInspection MCP integration'),
    subtotal: z.number().int().min(0).describe('TODO describe subtotal field for the OpenInspection MCP integration'),
}).openapi('ValidateDiscount');

export const ValidateDiscountResponseSchema = z.object({
    valid:          z.boolean().describe('TODO describe valid field for the OpenInspection MCP integration'),
    discountAmount: z.number().int().describe('TODO describe discountAmount field for the OpenInspection MCP integration'),
    discountCodeId: z.string().nullable().describe('TODO describe discountCodeId field for the OpenInspection MCP integration'),
    message:        z.string().optional().describe('TODO describe message field for the OpenInspection MCP integration'),
}).openapi('ValidateDiscountResponse');

export const ServiceListResponseSchema = createApiResponseSchema(z.array(ServiceSchema));
export const ServiceResponseSchema     = createApiResponseSchema(ServiceSchema);

// IA-26 — per-service inspector qualification
export const ServiceInspectorListResponseSchema = createApiResponseSchema(z.object({
    userIds: z.array(z.string()).describe('Restricted inspector user IDs; empty = all staff qualified'),
}));

export const SetServiceInspectorsSchema = z.object({
    userIds: z.array(z.string())
        .transform(a => [...new Set(a)])
        .describe('Full replacement list of inspector user IDs; empty array clears restriction; duplicates are silently deduplicated'),
}).openapi('SetServiceInspectors');

export const SetServiceInspectorsResponseSchema = createApiResponseSchema(z.object({
    count: z.number().int().describe('Number of restriction rows now in effect'),
}));
