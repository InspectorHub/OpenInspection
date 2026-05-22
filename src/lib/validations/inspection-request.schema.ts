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
    templateId: z.string().min(1, 'templateId is required').openapi({ example: '550e8400-e29b-41d4-a716-446655440002' }).describe('TODO describe templateId field for the OpenInspection MCP integration'),
    price:      z.number().int().min(0).optional().openapi({ example: 450 }).describe('TODO describe price field for the OpenInspection MCP integration'),
    notes:      z.string().max(500).optional().nullable().describe('TODO describe notes field for the OpenInspection MCP integration'),
}).openapi('CreateSubInspection');

export const CreateInspectionRequestSchema = z.object({
    clientName:      z.string().min(1).max(100).openapi({ example: 'Jane Smith' }).describe('TODO describe clientName field for the OpenInspection MCP integration'),
    clientEmail:     z.string().email().optional().nullable().openapi({ example: 'jane@example.com' }).describe('TODO describe clientEmail field for the OpenInspection MCP integration'),
    clientPhone:     z.string().max(30).optional().nullable().describe('TODO describe clientPhone field for the OpenInspection MCP integration'),
    propertyAddress: z.string().min(5).max(500).openapi({ example: '123 Main St, Anytown, ST' }).describe('TODO describe propertyAddress field for the OpenInspection MCP integration'),
    propertyCity:    z.string().max(100).optional().nullable().describe('TODO describe propertyCity field for the OpenInspection MCP integration'),
    propertyState:   z.string().max(10).optional().nullable().describe('TODO describe propertyState field for the OpenInspection MCP integration'),
    propertyZip:     z.string().max(20).optional().nullable().describe('TODO describe propertyZip field for the OpenInspection MCP integration'),
    scheduledAt:     z.string().min(1).openapi({ example: '2026-06-15T09:00:00Z' }).describe('TODO describe scheduledAt field for the OpenInspection MCP integration'),
    notes:           z.string().max(2000).optional().nullable().describe('TODO describe notes field for the OpenInspection MCP integration'),
    inspectorId:     z.string().uuid().optional().describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    subInspections:  z.array(SubInspectionInputSchema).min(1, 'At least one inspection is required').max(10).describe('TODO describe subInspections field for the OpenInspection MCP integration'),
}).openapi('CreateInspectionRequest');

export const UpdateInspectionRequestSchema = z.object({
    clientName:      z.string().min(1).max(100).optional().describe('TODO describe clientName field for the OpenInspection MCP integration'),
    clientEmail:     z.string().email().optional().nullable().describe('TODO describe clientEmail field for the OpenInspection MCP integration'),
    clientPhone:     z.string().max(30).optional().nullable().describe('TODO describe clientPhone field for the OpenInspection MCP integration'),
    propertyAddress: z.string().min(5).max(500).optional().describe('TODO describe propertyAddress field for the OpenInspection MCP integration'),
    propertyCity:    z.string().max(100).optional().nullable().describe('TODO describe propertyCity field for the OpenInspection MCP integration'),
    propertyState:   z.string().max(10).optional().nullable().describe('TODO describe propertyState field for the OpenInspection MCP integration'),
    propertyZip:     z.string().max(20).optional().nullable().describe('TODO describe propertyZip field for the OpenInspection MCP integration'),
    scheduledAt:     z.string().min(1).optional().describe('TODO describe scheduledAt field for the OpenInspection MCP integration'),
    notes:           z.string().max(2000).optional().nullable().describe('TODO describe notes field for the OpenInspection MCP integration'),
    status:          z.enum(['pending', 'confirmed', 'in_progress', 'completed', 'cancelled']).optional().describe('TODO describe status field for the OpenInspection MCP integration'),
    paymentStatus:   z.enum(['unpaid', 'partial', 'paid']).optional().describe('TODO describe paymentStatus field for the OpenInspection MCP integration'),
    totalAmount:     z.number().int().min(0).optional().describe('TODO describe totalAmount field for the OpenInspection MCP integration'),
}).openapi('UpdateInspectionRequest');

export const InspectionRequestListQuerySchema = z.object({
    status: z.enum(['pending', 'confirmed', 'in_progress', 'completed', 'cancelled']).optional().describe('TODO describe status field for the OpenInspection MCP integration'),
    from:   z.string().optional().describe('TODO describe from field for the OpenInspection MCP integration'),
    to:     z.string().optional().describe('TODO describe to field for the OpenInspection MCP integration'),
    limit:  z.coerce.number().min(1).max(200).default(50).describe('TODO describe limit field for the OpenInspection MCP integration'),
    offset: z.coerce.number().min(0).default(0).describe('TODO describe offset field for the OpenInspection MCP integration'),
}).openapi('InspectionRequestListQuery');

const SubInspectionResponseSchema = z.object({
    id:              z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    templateId:      z.string().nullable().describe('TODO describe templateId field for the OpenInspection MCP integration'),
    templateName:    z.string().nullable().optional().describe('TODO describe templateName field for the OpenInspection MCP integration'),
    propertyAddress: z.string().describe('TODO describe propertyAddress field for the OpenInspection MCP integration'),
    clientName:      z.string().nullable().describe('TODO describe clientName field for the OpenInspection MCP integration'),
    status:          z.string().describe('TODO describe status field for the OpenInspection MCP integration'),
    date:            z.string().describe('TODO describe date field for the OpenInspection MCP integration'),
    price:           z.number().describe('TODO describe price field for the OpenInspection MCP integration'),
    inspectorId:     z.string().nullable().describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
}).openapi('SubInspection');

export const InspectionRequestResponseSchema = z.object({
    id:               z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    tenantId:         z.string().describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    clientName:       z.string().describe('TODO describe clientName field for the OpenInspection MCP integration'),
    clientEmail:      z.string().nullable().describe('TODO describe clientEmail field for the OpenInspection MCP integration'),
    clientPhone:      z.string().nullable().describe('TODO describe clientPhone field for the OpenInspection MCP integration'),
    propertyAddress:  z.string().describe('TODO describe propertyAddress field for the OpenInspection MCP integration'),
    propertyCity:     z.string().nullable().describe('TODO describe propertyCity field for the OpenInspection MCP integration'),
    propertyState:    z.string().nullable().describe('TODO describe propertyState field for the OpenInspection MCP integration'),
    propertyZip:      z.string().nullable().describe('TODO describe propertyZip field for the OpenInspection MCP integration'),
    scheduledAt:      z.string().describe('TODO describe scheduledAt field for the OpenInspection MCP integration'),
    status:           z.enum(['pending', 'confirmed', 'in_progress', 'completed', 'cancelled']).describe('TODO describe status field for the OpenInspection MCP integration'),
    notes:            z.string().nullable().describe('TODO describe notes field for the OpenInspection MCP integration'),
    totalAmount:      z.number().describe('TODO describe totalAmount field for the OpenInspection MCP integration'),
    paymentStatus:    z.enum(['unpaid', 'partial', 'paid']).describe('TODO describe paymentStatus field for the OpenInspection MCP integration'),
    createdAt:        z.string().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
    updatedAt:        z.string().describe('TODO describe updatedAt field for the OpenInspection MCP integration'),
    inspections:      z.array(SubInspectionResponseSchema).describe('TODO describe inspections field for the OpenInspection MCP integration'),
}).openapi('InspectionRequest');

export const InspectionRequestListResponseSchema = createApiResponseSchema(z.object({
    requests: z.array(InspectionRequestResponseSchema).describe('TODO describe requests field for the OpenInspection MCP integration'),
    total:    z.number().describe('TODO describe total field for the OpenInspection MCP integration'),
})).openapi('InspectionRequestListResponse');

export const InspectionRequestDetailResponseSchema = createApiResponseSchema(z.object({
    request: InspectionRequestResponseSchema.describe('TODO describe request field for the OpenInspection MCP integration'),
})).openapi('InspectionRequestDetailResponse');
