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
    templateId: z.string().min(1, 'templateId is required').openapi({ example: '550e8400-e29b-41d4-a716-446655440002' }).describe('Id of the inspection template this inspection uses; must belong to this company. The template is copied onto the inspection at creation'),
    price:      z.number().int().min(0).optional().openapi({ example: 450 }).describe('Price for this inspection in integer cents (for example 45000 is 450.00 in the company currency); defaults to 0'),
    notes:      z.string().max(500).optional().nullable().describe('Notes for this inspection, up to 500 characters'),
}).openapi('CreateSubInspection');

export const CreateInspectionRequestSchema = z.object({
    clientName:      z.string().min(1).max(100).openapi({ example: 'Jane Smith' }).describe('Client name, 1-100 characters. The client is matched or created as a contact by email'),
    clientEmail:     z.string().email().optional().nullable().openapi({ example: 'jane@example.com' }).describe('Client email address; null or omitted when unknown. Used to match or create the client contact'),
    clientPhone:     z.string().max(30).optional().nullable().describe('Client phone number, up to 30 characters; null or omitted when unknown'),
    propertyAddress: z.string().min(5).max(500).openapi({ example: '123 Main St, Anytown, ST' }).describe('Address of the property to inspect, 5-500 characters. Every inspection in the request shares it'),
    propertyCity:    z.string().max(100).optional().nullable().describe('Property city, up to 100 characters'),
    propertyState:   z.string().max(10).optional().nullable().describe('Property state or region, up to 10 characters'),
    propertyZip:     z.string().max(20).optional().nullable().describe('Property postal code, up to 20 characters'),
    scheduledAt:     z.string().min(1).openapi({ example: '2026-06-15T09:00:00Z' }).describe('Scheduled date and time as an ISO 8601 timestamp (for example 2026-06-15T09:00:00Z). Every inspection in the request takes this value as its date'),
    notes:           z.string().max(2000).optional().nullable().describe('Notes about the request as a whole, up to 2000 characters'),
    inspectorId:     z.string().trim().min(1).optional().describe('Id of the inspector (a user in this company) assigned to every inspection in the request; omit to leave them unassigned'),
    subInspections:  z.array(SubInspectionInputSchema).min(1, 'At least one inspection is required').max(10).describe('The inspections to create under this request, 1-10, each with its own template and price'),
}).openapi('CreateInspectionRequest');

export const UpdateInspectionRequestSchema = z.object({
    clientName:      z.string().min(1).max(100).optional().describe('New client name, 1-100 characters'),
    clientEmail:     z.string().email().optional().nullable().describe('New client email address; null clears it'),
    clientPhone:     z.string().max(30).optional().nullable().describe('New client phone number, up to 30 characters; null clears it'),
    propertyAddress: z.string().min(5).max(500).optional().describe('New property address, 5-500 characters'),
    propertyCity:    z.string().max(100).optional().nullable().describe('New property city, up to 100 characters; null clears it'),
    propertyState:   z.string().max(10).optional().nullable().describe('New property state or region, up to 10 characters; null clears it'),
    propertyZip:     z.string().max(20).optional().nullable().describe('New property postal code, up to 20 characters; null clears it'),
    scheduledAt:     z.string().min(1).optional().describe('New scheduled date and time as an ISO 8601 timestamp. Applies to the request record only; inspections already created keep their own dates'),
    notes:           z.string().max(2000).optional().nullable().describe('New notes for the request, up to 2000 characters; null clears them'),
    status:          z.enum(['pending', 'confirmed', 'in_progress', 'completed', 'cancelled']).optional().describe('New request status: pending, confirmed, in_progress, completed or cancelled. Changes the request record only, not its inspections'),
}).openapi('UpdateInspectionRequest');

export const InspectionRequestListQuerySchema = z.object({
    status: z.enum(['pending', 'confirmed', 'in_progress', 'completed', 'cancelled']).optional().describe('Return only requests in this status.'),
    from:   z.string().optional().describe('Earliest scheduled date to include (inclusive). Any date or ISO 8601 timestamp string that the JavaScript Date parser accepts.'),
    to:     z.string().optional().describe('Latest scheduled date to include (inclusive). Same format as from. A bare date is read as the start of that day in UTC.'),
    limit:  z.coerce.number().min(1).max(200).default(50).describe('Maximum number of requests to return in one page.'),
    offset: z.coerce.number().min(0).default(0).describe('Number of requests to skip before the page starts, for paging.'),
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
