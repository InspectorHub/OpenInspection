import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { eq, and } from 'drizzle-orm';
import { availability, availabilityOverrides } from '../lib/db/schema';
import { safeISODate } from '../lib/date';
import { deniedByRule } from '../lib/permission-denied';
import { requireRole } from '../lib/middleware/rbac';
import { isAdminRole } from '../lib/auth/roles';
import { canViewOthersCalendar } from '../lib/calendar/view-others';
import {
    AvailabilitySchema,
    OverrideSchema,
    AvailabilityListResponseSchema,
    OverrideListResponseSchema,
    OverrideResponseSchema
} from '../lib/validations/booking.schema';
import { SuccessResponseSchema, createApiResponseSchema } from '../lib/validations/shared.schema';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { getDrizzle } from '../lib/route-helpers';
import { auditFromContext } from '../lib/audit';

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
    description: 'Returns the recurring weekly availability slots for an inspector. Defaults to the caller; owners, managers and anyone holding the scheduleOthers capability can query any inspector via the inspectorId query parameter.',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        query: z.object({
            inspectorId: z.string().trim().min(1).optional().describe('Inspector UUID to query; defaults to the caller when omitted.'),
        }),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: AvailabilityListResponseSchema,
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
                    schema: AvailabilitySchema.describe('The inspector weekly schedule; the submitted slots replace the existing schedule in full.'),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ count: z.number() })),
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
    description: 'Returns availability override entries (blocked dates and custom slots) for an inspector. Used by the calendar UI to render day-level adjustments. The entries of another inspector need an owner or manager role or the scheduleOthers capability.',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        query: z.object({
            inspectorId: z.string().trim().min(1).optional().describe('Inspector UUID to query; defaults to the caller when omitted.'),
        }),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: OverrideListResponseSchema,
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
                    schema: OverrideSchema.describe('A single date-specific override that blocks a date or replaces the weekly schedule for it.'),
                },
            },
        },
    },
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: OverrideResponseSchema,
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
    description: 'Removes a manual availability override, restoring the default recurring schedule for that date. Owners and managers may remove any; an inspector only their own (403 otherwise). An entry synced from a connected calendar is managed by that connection and is refused with 409. The removal is written to the audit log.',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('UUID of the availability override entry to delete.') }),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: SuccessResponseSchema,
                },
            },
            description: 'Success',
        },
        403: { description: 'An inspector tried to remove an override that belongs to another inspector' },
        404: { description: 'No such override in this company' },
        409: { description: 'The entry is synced from a connected calendar and cannot be removed here' },
    },
}, { scopes: ['write'], tier: 'extended' }));

export const availabilityRoutes = createApiRouter()
    .openapi(listAvailabilityRoute, async (c) => {
        const db = getDrizzle(c);
        const tenantId = c.get('tenantId');
        const user = c.get('user');
        const { inspectorId: queryId } = c.req.valid('query');

        if (queryId && queryId !== user.sub && !await canViewOthersCalendar(c)) {
            throw deniedByRule(c, 'You can only view your own availability', 'An owner, a manager or someone with the scheduleOthers capability');
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

        if (inspectorId !== user.sub && !isAdminRole(userRole)) {
            throw deniedByRule(c, 'You can only manage your own availability', 'An owner or manager');
        }

        const service = c.var.services.availability;
        await service.updateWeeklySchedule(tenantId, inspectorId, body.slots);

        return c.json({ success: true, data: { count: body.slots.length } }, 200);
    })
    .openapi(listOverridesRoute, async (c) => {
        const db = getDrizzle(c);
        const tenantId = c.get('tenantId');
        const user = c.get('user');
        const { inspectorId: queryId } = c.req.valid('query');

        if (queryId && queryId !== user.sub && !await canViewOthersCalendar(c)) {
            throw deniedByRule(c, 'You can only view your own availability', 'An owner, a manager or someone with the scheduleOthers capability');
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
        if (inspectorId !== user.sub && !isAdminRole(userRole)) {
            throw deniedByRule(c, 'You can only manage your own availability', 'An owner or manager');
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
        const user = c.get('user');
        const { id } = c.req.valid('param');
        const service = c.var.services.availability;
        // The same rule as creating one: an owner or manager for anyone, an inspector for their own.
        const existing = await service.getOverride(tenantId, id);
        if (existing.inspectorId !== user.sub && !isAdminRole(c.get('userRole'))) {
            throw deniedByRule(c, 'You can only manage your own availability', 'An owner or manager');
        }
        await service.deleteOverride(tenantId, id);
        auditFromContext(c, 'availability.override.delete', 'availability_override', {
            entityId: id,
            metadata: { date: existing.date, kind: existing.isAvailable ? 'extra-hours' : 'manual', inspectorId: existing.inspectorId },
        });
        return c.json({ success: true }, 200);
    });

export type AvailabilityApi = typeof availabilityRoutes;
