import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

/**
 * Validation schema for the public booking request.
 *
 * Sprint 1 C-6 — `timeSlot` extended from morning/afternoon to a 4-option
 * window enum. `all-day` collapses to a morning slot internally; `custom`
 * requires a paired `customTime` (HH:mm) — see bookings.ts for the mapping.
 */
export const PublicBookingSchema = z.object({
    address: z.string().min(5, 'Address is too short').openapi({ example: '123 Main St, City, ST 12345' }).describe('TODO describe address field for the OpenInspection MCP integration'),
    clientName: z.string().min(1, 'Client name is required').openapi({ example: 'John Doe' }).describe('TODO describe clientName field for the OpenInspection MCP integration'),
    clientEmail: z.string().email('Invalid email address').openapi({ example: 'john@example.com' }).describe('TODO describe clientEmail field for the OpenInspection MCP integration'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').openapi({ example: '2024-04-15' }).describe('TODO describe date field for the OpenInspection MCP integration'),
    timeSlot: z.enum(['morning', 'afternoon', 'all-day', 'custom']).openapi({ example: 'morning' }).describe('TODO describe timeSlot field for the OpenInspection MCP integration'),
    customTime: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time format (HH:mm)').optional().openapi({ example: '13:30' }).describe('TODO describe customTime field for the OpenInspection MCP integration'),
    inspectorId: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    turnstileToken: z.string().optional().openapi({ example: '0.xtoken...' }).describe('TODO describe turnstileToken field for the OpenInspection MCP integration'),
    // Sprint 2 S2-2 — Multi-inspection per request. Customer can pick multiple
    // services in a single visit. When omitted (legacy single-service flow),
    // the server still creates a one-inspection request to keep the data model
    // uniform. `serviceIds` are tenant Service entries; their templateId is
    // resolved server-side.
    services: z.array(z.object({
        serviceId: z.string().min(1).openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe serviceId field for the OpenInspection MCP integration'),
    })).min(1).max(10).optional().openapi({ description: 'Optional list of services to book in one visit (1-10)' }),
    // UC-A-1 — agent referral attribution. The `?ref=<agentSlug>` query param
    // on /book/<inspectorSlug> flows through the form as a hidden field. Server
    // resolves the slug to a global agent user, finds their active link to
    // this tenant, and persists the linked inspectorContactId on
    // inspections.referredByAgentId.
    agentRefSlug: z.string().min(2).max(64).optional().openapi({ example: 'jane-tester' }).describe('TODO describe agentRefSlug field for the OpenInspection MCP integration'),
}).refine(
    (data) => data.timeSlot !== 'custom' || !!data.customTime,
    { message: 'customTime is required when timeSlot is custom', path: ['customTime'] },
).openapi('PublicBooking');

/**
 * Validation schema for recurring weekly availability.
 */
export const AvailabilitySchema = z.object({
    inspectorId: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    slots: z.array(z.object({
        dayOfWeek: z.number().min(0).max(6).openapi({ example: 1 }).describe('TODO describe dayOfWeek field for the OpenInspection MCP integration'),
        startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time format (HH:mm)').openapi({ example: '09:00' }).describe('TODO describe startTime field for the OpenInspection MCP integration'),
        endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time format (HH:mm)').openapi({ example: '17:00' }).describe('TODO describe endTime field for the OpenInspection MCP integration'),
    })).min(1).openapi({ description: 'List of weekly availability slots' }),
}).openapi('Availability');

/**
 * Validation schema for date-specific availability overrides.
 */
export const OverrideSchema = z.object({
    inspectorId: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)').openapi({ example: '2024-04-16' }).describe('TODO describe date field for the OpenInspection MCP integration'),
    isAvailable: z.boolean().openapi({ example: false }).describe('TODO describe isAvailable field for the OpenInspection MCP integration'),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time format (HH:mm)').optional().nullable().openapi({ example: '09:00' }).describe('TODO describe startTime field for the OpenInspection MCP integration'),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time format (HH:mm)').optional().nullable().openapi({ example: '17:00' }).describe('TODO describe endTime field for the OpenInspection MCP integration'),
}).openapi('Override');

/**
 * Response Schemas
 */
export const InspectorsResponseSchema = createApiResponseSchema(z.object({
    inspectors: z.array(z.object({
        id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe id field for the OpenInspection MCP integration'),
        name: z.string().openapi({ example: 'Jane Smith' }).describe('TODO describe name field for the OpenInspection MCP integration'),
    })).describe('TODO describe inspectors field for the OpenInspection MCP integration'),
})).openapi('InspectorsResponse');

export const AvailabilityResponseSchema = createApiResponseSchema(z.object({
    bookedSlots: z.array(z.string()).openapi({ example: ['2024-04-15T09:00:00Z'] }).describe('TODO describe bookedSlots field for the OpenInspection MCP integration'),
    overrides: z.array(z.any()).openapi({ description: 'Active availability overrides' }),
    baseAvailability: z.array(z.any()).openapi({ description: 'Standard weekly availability' }),
})).openapi('AvailabilityResponse');

export const BookingResponseSchema = createApiResponseSchema(z.object({
    success: z.boolean().openapi({ example: true }).describe('TODO describe success field for the OpenInspection MCP integration'),
    // Single-service legacy callers still get the first inspection's id here.
    inspectionId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe inspectionId field for the OpenInspection MCP integration'),
    // Sprint 2 S2-2 — request grouping is always present, even for single-service bookings.
    requestId: z.string().optional().openapi({ example: 'req-abc12345' }).describe('TODO describe requestId field for the OpenInspection MCP integration'),
    inspectionIds: z.array(z.string().uuid()).optional().openapi({ description: 'All inspection ids in the request' }),
})).openapi('BookingResponse');

export const AvailabilityListResponseSchema = createApiResponseSchema(z.object({
    availability: z.array(z.object({
        id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
        dayOfWeek: z.number().describe('TODO describe dayOfWeek field for the OpenInspection MCP integration'),
        startTime: z.string().describe('TODO describe startTime field for the OpenInspection MCP integration'),
        endTime: z.string().describe('TODO describe endTime field for the OpenInspection MCP integration'),
        inspectorId: z.string().uuid().describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    })).describe('TODO describe availability field for the OpenInspection MCP integration'),
})).openapi('AvailabilityListResponse');

export const OverrideListResponseSchema = createApiResponseSchema(z.object({
    overrides: z.array(z.object({
        id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
        date: z.string().describe('TODO describe date field for the OpenInspection MCP integration'),
        isAvailable: z.boolean().describe('TODO describe isAvailable field for the OpenInspection MCP integration'),
        startTime: z.string().nullable().describe('TODO describe startTime field for the OpenInspection MCP integration'),
        endTime: z.string().nullable().describe('TODO describe endTime field for the OpenInspection MCP integration'),
        inspectorId: z.string().uuid().describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    })).describe('TODO describe overrides field for the OpenInspection MCP integration'),
})).openapi('OverrideListResponse');

export const OverrideResponseSchema = createApiResponseSchema(z.object({
    override: z.object({
        id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
        date: z.string().describe('TODO describe date field for the OpenInspection MCP integration'),
        isAvailable: z.boolean().describe('TODO describe isAvailable field for the OpenInspection MCP integration'),
        startTime: z.string().nullable().describe('TODO describe startTime field for the OpenInspection MCP integration'),
        endTime: z.string().nullable().describe('TODO describe endTime field for the OpenInspection MCP integration'),
        inspectorId: z.string().uuid().describe('TODO describe inspectorId field for the OpenInspection MCP integration'),
    }).describe('TODO describe override field for the OpenInspection MCP integration'),
})).openapi('OverrideResponse');
