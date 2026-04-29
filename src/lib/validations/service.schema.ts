import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

export const ServiceSchema = z.object({
    id:              z.string(),
    tenantId:        z.string(),
    name:            z.string(),
    description:     z.string().nullable(),
    price:           z.number().int(),
    durationMinutes: z.number().int().nullable(),
    templateId:      z.string().nullable(),
    agreementId:     z.string().nullable(),
    active:          z.boolean(),
    sortOrder:       z.number().int(),
    createdAt:       z.string().nullable(),
}).openapi('Service');

export const CreateServiceSchema = z.object({
    name:            z.string().min(1).max(200),
    description:     z.string().max(1000).optional(),
    price:           z.number().int().min(0),
    durationMinutes: z.number().int().min(0).optional(),
    templateId:      z.string().optional(),
    agreementId:     z.string().optional(),
    sortOrder:       z.number().int().optional(),
}).openapi('CreateService');

export const UpdateServiceSchema = CreateServiceSchema.partial().extend({
    active: z.boolean().optional(),
}).openapi('UpdateService');

export const DiscountCodeSchema = z.object({
    id:         z.string(),
    tenantId:   z.string(),
    code:       z.string(),
    type:       z.enum(['fixed', 'percent']),
    value:      z.number().int(),
    maxUses:    z.number().int().nullable(),
    usesCount:  z.number().int(),
    expiresAt:  z.string().nullable(),
    active:     z.boolean(),
    createdAt:  z.string().nullable(),
}).openapi('DiscountCode');

export const CreateDiscountCodeSchema = z.object({
    code:      z.string().min(1).max(50),
    type:      z.enum(['fixed', 'percent']),
    value:     z.number().int().min(1),
    maxUses:   z.number().int().min(1).optional(),
    expiresAt: z.string().datetime().optional(),
}).openapi('CreateDiscountCode');

export const ValidateDiscountSchema = z.object({
    code:     z.string().min(1),
    subtotal: z.number().int().min(0),
}).openapi('ValidateDiscount');

export const ValidateDiscountResponseSchema = z.object({
    valid:          z.boolean(),
    discountAmount: z.number().int(),
    discountCodeId: z.string().nullable(),
    message:        z.string().optional(),
}).openapi('ValidateDiscountResponse');

export const ServiceListResponseSchema = createApiResponseSchema(z.array(ServiceSchema));
export const ServiceResponseSchema     = createApiResponseSchema(ServiceSchema);
