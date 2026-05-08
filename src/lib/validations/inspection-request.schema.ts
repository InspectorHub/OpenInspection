import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

/**
 * Sprint 2 S2-2 — Multi-inspection per request schemas.
 *
 * A request groups N inspections that share property + schedule. Each
 * sub-inspection picks its own template (Residential / Radon / Termite, etc).
 *
 * `tenantId` is never accepted from user input — the service layer pulls it
 * from the verified JWT claim.
 */

const SubInspectionInputSchema = z.object({
    templateId: z.string().min(1, 'templateId is required').openapi({ example: '550e8400-e29b-41d4-a716-446655440002' }),
    price:      z.number().int().min(0).optional().openapi({ example: 450 }),
    notes:      z.string().max(500).optional().nullable(),
}).openapi('CreateSubInspection');

export const CreateInspectionRequestSchema = z.object({
    clientName:      z.string().min(1).max(100).openapi({ example: 'Jane Smith' }),
    clientEmail:     z.string().email().optional().nullable().openapi({ example: 'jane@example.com' }),
    clientPhone:     z.string().max(30).optional().nullable(),
    propertyAddress: z.string().min(5).max(500).openapi({ example: '123 Main St, Anytown, ST' }),
    propertyCity:    z.string().max(100).optional().nullable(),
    propertyState:   z.string().max(10).optional().nullable(),
    propertyZip:     z.string().max(20).optional().nullable(),
    scheduledAt:     z.string().min(1).openapi({ example: '2026-06-15T09:00:00Z' }),
    notes:           z.string().max(2000).optional().nullable(),
    inspectorId:     z.string().uuid().optional(),
    subInspections:  z.array(SubInspectionInputSchema).min(1, 'At least one inspection is required').max(10),
}).openapi('CreateInspectionRequest');

export const UpdateInspectionRequestSchema = z.object({
    clientName:      z.string().min(1).max(100).optional(),
    clientEmail:     z.string().email().optional().nullable(),
    clientPhone:     z.string().max(30).optional().nullable(),
    propertyAddress: z.string().min(5).max(500).optional(),
    propertyCity:    z.string().max(100).optional().nullable(),
    propertyState:   z.string().max(10).optional().nullable(),
    propertyZip:     z.string().max(20).optional().nullable(),
    scheduledAt:     z.string().min(1).optional(),
    notes:           z.string().max(2000).optional().nullable(),
    status:          z.enum(['pending', 'confirmed', 'in_progress', 'completed', 'cancelled']).optional(),
    paymentStatus:   z.enum(['unpaid', 'partial', 'paid']).optional(),
    totalAmount:     z.number().int().min(0).optional(),
}).openapi('UpdateInspectionRequest');

export const InspectionRequestListQuerySchema = z.object({
    status: z.enum(['pending', 'confirmed', 'in_progress', 'completed', 'cancelled']).optional(),
    from:   z.string().optional(),
    to:     z.string().optional(),
    limit:  z.coerce.number().min(1).max(200).default(50),
    offset: z.coerce.number().min(0).default(0),
}).openapi('InspectionRequestListQuery');

const SubInspectionResponseSchema = z.object({
    id:              z.string(),
    templateId:      z.string().nullable(),
    templateName:    z.string().nullable().optional(),
    propertyAddress: z.string(),
    clientName:      z.string().nullable(),
    status:          z.string(),
    date:            z.string(),
    price:           z.number(),
    inspectorId:     z.string().nullable(),
}).openapi('SubInspection');

export const InspectionRequestResponseSchema = z.object({
    id:               z.string(),
    tenantId:         z.string(),
    clientName:       z.string(),
    clientEmail:      z.string().nullable(),
    clientPhone:      z.string().nullable(),
    propertyAddress:  z.string(),
    propertyCity:     z.string().nullable(),
    propertyState:    z.string().nullable(),
    propertyZip:      z.string().nullable(),
    scheduledAt:      z.string(),
    status:           z.enum(['pending', 'confirmed', 'in_progress', 'completed', 'cancelled']),
    notes:            z.string().nullable(),
    totalAmount:      z.number(),
    paymentStatus:    z.enum(['unpaid', 'partial', 'paid']),
    createdAt:        z.string(),
    updatedAt:        z.string(),
    inspections:      z.array(SubInspectionResponseSchema),
}).openapi('InspectionRequest');

export const InspectionRequestListResponseSchema = createApiResponseSchema(z.object({
    requests: z.array(InspectionRequestResponseSchema),
    total:    z.number(),
})).openapi('InspectionRequestListResponse');

export const InspectionRequestDetailResponseSchema = createApiResponseSchema(z.object({
    request: InspectionRequestResponseSchema,
})).openapi('InspectionRequestDetailResponse');
