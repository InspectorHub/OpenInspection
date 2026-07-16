import { createRoute } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import { createApiRouter } from '../lib/openapi-router';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import {
    CalendarItemsErrorSchema,
    CalendarItemsResponseSchema,
    ListCalendarItemsQuerySchema,
} from '../lib/validations/calendar-items.schema';
import { listCalendarItems } from '../services/calendar-items.service';

const allowedRoles = requireRole('owner', 'manager', 'inspector');

const listItemsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/items',
    operationId: 'listCalendarItems',
    tags: ['calendar'],
    summary: 'List unified calendar items',
    description: 'Combines inspections, inspection events, calendar blocks, and external busy time for a civil-date or instant range. Owners and managers may select multiple users; inspectors are restricted to themselves.',
    middleware: [allowedRoles],
    request: {
        query: ListCalendarItemsQuerySchema,
    },
    responses: {
        200: {
            content: { 'application/json': { schema: CalendarItemsResponseSchema } },
            description: 'Calendar items in chronological order',
        },
        400: {
            content: { 'application/json': { schema: CalendarItemsErrorSchema } },
            description: 'Invalid range or user selection',
        },
        403: {
            content: { 'application/json': { schema: CalendarItemsErrorSchema } },
            description: 'The caller cannot view the selected user calendars',
        },
    },
    security: [{ bearerAuth: [] }],
}, { scopes: ['read'], tier: 'primary' }));

function errorResponse(message: string, code: 'FORBIDDEN') {
    return {
        success: false as const,
        error: { message, code },
    };
}

function isAdmin(role: string | undefined): boolean {
    return role === 'owner' || role === 'manager';
}

const calendarItemsRoutes = createApiRouter()
    .openapi(listItemsRoute, async (c) => {
        const user = c.get('user');
        const role = c.get('userRole');
        const tenantId = c.get('tenantId');
        const query = c.req.valid('query');
        const requestedUserIds = query.userId ? [query.userId] : query.userIds;

        let userIds = requestedUserIds;
        if (!isAdmin(role)) {
            if (requestedUserIds?.some((userId) => userId !== user.sub)) {
                return c.json(errorResponse(
                    'Inspectors can only view their own calendar',
                    'FORBIDDEN',
                ), 403);
            }
            userIds = [user.sub];
        }

        const items = await listCalendarItems(c.env.DB, tenantId, {
            start: query.start,
            end: query.end,
            ...(userIds ? { userIds } : {}),
        });

        return c.json({
            success: true as const,
            data: { items },
        }, 200);
    });

export default calendarItemsRoutes;
