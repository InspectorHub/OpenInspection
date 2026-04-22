import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { availability, availabilityOverrides } from '../lib/db/schema';
import { HonoConfig } from '../types/hono';
import { safeISODate } from '../lib/date';
import { Errors } from '../lib/errors';
import { requireRole } from '../lib/middleware/rbac';
import { 
    AvailabilitySchema, 
    OverrideSchema,
    AvailabilityListResponseSchema,
    OverrideListResponseSchema,
    OverrideResponseSchema
} from '../lib/validations/booking.schema';
import { SuccessResponseSchema, createApiResponseSchema } from '../lib/validations/shared.schema';

const availabilityRoutes = new OpenAPIHono<HonoConfig>();

/**
 * GET /api/availability
 * Returns recurring slots for an inspector.
 */
const listAvailabilityRoute = createRoute({
    method: 'get',
    path: '/',
    tags: ['Availability'],
    summary: 'List recurring availability',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        query: z.object({
            inspectorId: z.string().uuid().optional(),
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
});

availabilityRoutes.openapi(listAvailabilityRoute, async (c) => {
    const db = drizzle(c.env.DB);
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const { inspectorId: queryId } = c.req.valid('query');
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

    return c.json({ success: true, data: { availability: formattedAvailability } }, 200);
});

/**
 * PUT /api/availability
 * Replaces recurring slots.
 */
const updateScheduleRoute = createRoute({
    method: 'put',
    path: '/',
    tags: ['Availability'],
    summary: 'Update weekly schedule',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        body: {
            content: {
                'application/json': {
                    schema: AvailabilitySchema,
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
});

availabilityRoutes.openapi(updateScheduleRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const userRole = c.get('userRole');
    const body = c.req.valid('json');

    const inspectorId = body.inspectorId || user.sub;

    if (inspectorId !== user.sub && !['admin', 'owner'].includes(userRole)) {
        throw Errors.Forbidden('Can only manage your own availability');
    }

    const service = c.var.services.availability;
    await service.updateWeeklySchedule(tenantId, inspectorId, body.slots);
    
    return c.json({ success: true, data: { count: body.slots.length } }, 200);
});

/**
 * GET /api/availability/overrides
 */
const listOverridesRoute = createRoute({
    method: 'get',
    path: '/overrides',
    tags: ['Availability'],
    summary: 'List availability overrides',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        query: z.object({
            inspectorId: z.string().uuid().optional(),
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
});

availabilityRoutes.openapi(listOverridesRoute, async (c) => {
    const db = drizzle(c.env.DB);
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const { inspectorId: queryId } = c.req.valid('query');
    const inspectorId = queryId || user.sub;

    const overrides = await db.select()
        .from(availabilityOverrides)
        .where(and(eq(availabilityOverrides.tenantId, tenantId), eq(availabilityOverrides.inspectorId, inspectorId)))
        .all();

    const formattedOverrides = overrides.map(o => ({
        ...o,
        createdAt: safeISODate(o.createdAt)
    }));

    return c.json({ success: true, data: { overrides: formattedOverrides } }, 200);
});

/**
 * POST /api/availability/overrides
 */
const createOverrideRoute = createRoute({
    method: 'post',
    path: '/overrides',
    tags: ['Availability'],
    summary: 'Add availability override',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        body: {
            content: {
                'application/json': {
                    schema: OverrideSchema,
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
});

availabilityRoutes.openapi(createOverrideRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const userRole = c.get('userRole');
    const body = c.req.valid('json');

    const inspectorId = body.inspectorId || user.sub;
    if (inspectorId !== user.sub && !['admin', 'owner'].includes(userRole)) {
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
});

/**
 * DELETE /api/availability/overrides/:id
 */
const deleteOverrideRoute = createRoute({
    method: 'delete',
    path: '/overrides/{id}',
    tags: ['Availability'],
    summary: 'Delete availability override',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string().uuid() }),
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
    },
});

availabilityRoutes.openapi(deleteOverrideRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { id } = c.req.valid('param');
    const service = c.var.services.availability;
    await service.deleteOverride(tenantId, id);
    return c.json({ success: true, data: { success: true } }, 200);
});

export default availabilityRoutes;
