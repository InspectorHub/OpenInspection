import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { availability, availabilityOverrides } from '../lib/db/schema';
import { safeISODate } from '../lib/date';
import { Errors } from '../lib/errors';
import { requireRole } from '../lib/middleware/rbac';
import { ROLE } from '../lib/auth/roles';
import {
    AvailabilitySchema,
    OverrideSchema,
    AvailabilityListResponseSchema,
    OverrideListResponseSchema,
    OverrideResponseSchema
} from '../lib/validations/booking.schema';
import { SuccessResponseSchema, createApiResponseSchema } from '../lib/validations/shared.schema';
import { withMcpMetadata } from '../lib/route-metadata-standards';

/**
 * GET /api/availability
 * Returns recurring slots for an inspector.
 */
const listAvailabilityRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/',
    operationId: 'listRecurringAvailability',
    tags: ['bookings'],
    summary: 'List recurring weekly availability',
    description: 'Returns the recurring weekly availability slots for an inspector. Defaults to the caller; admins can query any inspector via the inspectorId query parameter.',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        query: z.object({
            inspectorId: z.string().uuid().optional().describe('Inspector UUID to query; defaults to the caller when omitted.'),
        }).describe('TODO describe query field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: AvailabilityListResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
}, { scopes: ['read'], tier: 'primary' }));

/**
 * PUT /api/availability
 * Replaces recurring slots.
 */
const updateScheduleRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/',
    operationId: 'updateWeeklyAvailability',
    tags: ['bookings'],
    summary: 'Replace weekly availability schedule',
    description: 'Replaces the inspector\'s recurring weekly schedule wholesale with the supplied slots. Admins can edit any inspector; others may only edit their own.',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        body: {
            content: {
                'application/json': {
                    schema: AvailabilitySchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ count: z.number().describe('TODO describe count field for the OpenInspection MCP integration') })),
                },
            },
            description: 'Success',
        },
    },
}, { scopes: ['write'], tier: 'extended' }));

/**
 * GET /api/availability/overrides
 */
const listOverridesRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/overrides',
    operationId: 'listAvailabilityOverrides',
    tags: ['bookings'],
    summary: 'List availability override entries',
    description: 'Returns availability override entries (blocked dates and custom slots) for an inspector. Used by the calendar UI to render day-level adjustments.',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        query: z.object({
            inspectorId: z.string().uuid().optional().describe('Inspector UUID to query; defaults to the caller when omitted.'),
        }).describe('TODO describe query field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: OverrideListResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
}, { scopes: ['read'], tier: 'extended' }));

/**
 * POST /api/availability/overrides
 */
const createOverrideRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/overrides',
    operationId: 'createAvailabilityOverride',
    tags: ['bookings'],
    summary: 'Create an availability override',
    description: 'Adds a single availability override (block a date, add an unusual slot). Admins may create overrides for any inspector; others only for themselves.',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        body: {
            content: {
                'application/json': {
                    schema: OverrideSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: OverrideResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Created',
        },
    },
}, { scopes: ['write'], tier: 'extended' }));

/**
 * DELETE /api/availability/overrides/:id
 */
const deleteOverrideRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/overrides/{id}',
    operationId: 'deleteAvailabilityOverride',
    tags: ['bookings'],
    summary: 'Delete an availability override',
    description: 'Removes the specified availability override entry, restoring the default recurring schedule for that date.',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('UUID of the availability override entry to delete.') }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
}, { scopes: ['write'], tier: 'extended' }));

export const availabilityRoutes = createApiRouter()
    .openapi(listAvailabilityRoute, async (c) => {
        const db = drizzle(c.env.DB);
        const tenantId = c.get('tenantId');
        const user = c.get('user');
        const userRole = c.get('userRole');
        const { inspectorId: queryId } = c.req.valid('query');

        if (queryId && queryId !== user.sub && ![ROLE.MANAGER, ROLE.OWNER].includes(userRole)) {
            throw Errors.Forbidden('Can only view your own availability');
        }

        const inspectorId = queryId || user.sub;

        const slots = await db.select()
            .from(availability)
            .where(and(eq(availability.tenantId, tenantId), eq(availability.inspectorId, inspectorId)))
            .all();

        // Ensure createdAt is formatted as a string for the response
        const formattedAvailability = slots.map(s => ({
            ...s,
            createdAt: safeISODate(s.createdAt)
        }));

        return c.json({ success: true, data: formattedAvailability }, 200);
    })
    .openapi(updateScheduleRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const user = c.get('user');
        const userRole = c.get('userRole');
        const body = c.req.valid('json');

        const inspectorId = body.inspectorId || user.sub;

        if (inspectorId !== user.sub && ![ROLE.MANAGER, ROLE.OWNER].includes(userRole)) {
            throw Errors.Forbidden('Can only manage your own availability');
        }

        const service = c.var.services.availability;
        await service.updateWeeklySchedule(tenantId, inspectorId, body.slots);

        return c.json({ success: true, data: { count: body.slots.length } }, 200);
    })
    .openapi(listOverridesRoute, async (c) => {
        const db = drizzle(c.env.DB);
        const tenantId = c.get('tenantId');
        const user = c.get('user');
        const userRole = c.get('userRole');
        const { inspectorId: queryId } = c.req.valid('query');

        if (queryId && queryId !== user.sub && ![ROLE.MANAGER, ROLE.OWNER].includes(userRole)) {
            throw Errors.Forbidden('Can only view your own availability');
        }

        const inspectorId = queryId || user.sub;

        const overrides = await db.select()
            .from(availabilityOverrides)
            .where(and(eq(availabilityOverrides.tenantId, tenantId), eq(availabilityOverrides.inspectorId, inspectorId)))
            .all();

        const formattedOverrides = overrides.map(o => ({
            ...o,
            createdAt: safeISODate(o.createdAt)
        }));

        return c.json({ success: true, data: formattedOverrides }, 200);
    })
    .openapi(createOverrideRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const user = c.get('user');
        const userRole = c.get('userRole');
        const body = c.req.valid('json');

        const inspectorId = body.inspectorId || user.sub;
        if (inspectorId !== user.sub && ![ROLE.MANAGER, ROLE.OWNER].includes(userRole)) {
            throw Errors.Forbidden('Can only manage your own availability');
        }

        const service = c.var.services.availability;
        // Filter undefined for exactOptionalPropertyTypes
        const overrideParams = Object.fromEntries(
            Object.entries(body).filter(([_, v]) => v !== undefined)
        ) as typeof body;

        const override = await service.addOverride(tenantId, {
            ...overrideParams,
            inspectorId
        });

        return c.json({ success: true, data: { override: override } }, 201);
    })
    .openapi(deleteOverrideRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const service = c.var.services.availability;
        await service.deleteOverride(tenantId, id);
        return c.json({ success: true }, 200);
    });

export type AvailabilityApi = typeof availabilityRoutes;
