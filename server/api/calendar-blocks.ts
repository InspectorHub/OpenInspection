import { createRoute } from '@hono/zod-openapi';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { calendarBlocks, users } from '../lib/db/schema';
import { safeISODate } from '../lib/date';
import { requireRole } from '../lib/middleware/rbac';
import { createApiRouter } from '../lib/openapi-router';
import { pushBlockAfterResponse, dropExternalAfterResponse } from '../lib/calendar/push-hooks';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { isAdminRole } from '../lib/auth/roles';
import { canViewOthersCalendar } from '../lib/calendar/view-others';
import { getDrizzle, type AppDrizzle } from '../lib/route-helpers';
import { findTimeOffConflicts } from '../lib/schedule-conflicts';
import { resolveInspectionScope } from '../lib/inspection/visibility';
import {
    CalendarBlockErrorSchema,
    CalendarBlockListResponseSchema,
    ConflictsQuerySchema,
    ConflictsResponseSchema,
    CalendarBlockParamsSchema,
    CalendarBlockResponseSchema,
    CreateCalendarBlockSchema,
    DeleteCalendarBlockResponseSchema,
    ListCalendarBlocksQuerySchema,
    UpdateCalendarBlockSchema,
} from '../lib/validations/calendar-blocks.schema';

const allowedRoles = requireRole('owner', 'manager', 'inspector');

const errorResponses = {
    403: {
        content: { 'application/json': { schema: CalendarBlockErrorSchema } },
        description: 'The caller cannot manage the selected user calendar',
    },
    404: {
        content: { 'application/json': { schema: CalendarBlockErrorSchema } },
        description: 'Calendar block or target user not found in this tenant',
    },
} as const;

const createBlockRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/blocks',
    operationId: 'createCalendarBlock',
    tags: ['calendar'],
    summary: 'Create a calendar block',
    description: 'Creates an all-day or timed calendar block. Inspectors can create blocks for themselves; owners and managers can create blocks for any user in their company.',
    middleware: [allowedRoles],
    request: {
        body: {
            content: { 'application/json': { schema: CreateCalendarBlockSchema } },
        },
    },
    responses: {
        201: {
            content: { 'application/json': { schema: CalendarBlockResponseSchema } },
            description: 'Calendar block created',
        },
        ...errorResponses,
    },
    security: [{ bearerAuth: [] }],
}, { scopes: ['write'], tier: 'primary' }));

const blockConflictsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/blocks/conflicts',
    operationId: 'previewCalendarBlockConflicts',
    tags: ['calendar'],
    summary: 'Preview the booked inspections a block would cover',
    description: 'Answers, before anything is saved, which booked inspections (not cancelled) a block of time off on a civil date would cover: an id, a date and a time window each, nothing else. Informational only; creating the block never requires it. Inspectors can ask about themselves; owners, managers and anyone holding the scheduleOthers capability about another user.',
    middleware: [allowedRoles],
    request: { query: ConflictsQuerySchema },
    responses: {
        200: {
            content: { 'application/json': { schema: ConflictsResponseSchema } },
            description: 'The covered inspections, possibly none',
        },
        ...errorResponses,
    },
    security: [{ bearerAuth: [] }],
}, { scopes: ['read'], tier: 'extended' }));

const listBlocksRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/blocks',
    operationId: 'listCalendarBlocks',
    tags: ['calendar'],
    summary: 'List calendar blocks in range',
    description: 'Lists calendar blocks within an inclusive civil-date range. Inspectors can list their own blocks; owners, managers and anyone holding the scheduleOthers capability can select another user.',
    middleware: [allowedRoles],
    request: { query: ListCalendarBlocksQuerySchema },
    responses: {
        200: {
            content: { 'application/json': { schema: CalendarBlockListResponseSchema } },
            description: 'Calendar blocks in date order',
        },
        ...errorResponses,
    },
    security: [{ bearerAuth: [] }],
}, { scopes: ['read'], tier: 'primary' }));

const updateBlockRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/blocks/{id}',
    operationId: 'updateCalendarBlock',
    tags: ['calendar'],
    summary: 'Update a calendar block',
    description: 'Updates an owned calendar block. Owners and managers can update or reassign any block in their company.',
    middleware: [allowedRoles],
    request: {
        params: CalendarBlockParamsSchema,
        body: {
            content: { 'application/json': { schema: UpdateCalendarBlockSchema } },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: CalendarBlockResponseSchema } },
            description: 'Calendar block updated',
        },
        ...errorResponses,
    },
    security: [{ bearerAuth: [] }],
}, { scopes: ['write'], tier: 'primary' }));

const deleteBlockRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/blocks/{id}',
    operationId: 'deleteCalendarBlock',
    tags: ['calendar'],
    summary: 'Delete a calendar block',
    description: 'Deletes an owned calendar block. Owners and managers can delete any block in their company.',
    middleware: [allowedRoles],
    request: { params: CalendarBlockParamsSchema },
    responses: {
        200: {
            content: { 'application/json': { schema: DeleteCalendarBlockResponseSchema } },
            description: 'Calendar block deleted',
        },
        ...errorResponses,
    },
    security: [{ bearerAuth: [] }],
}, { scopes: ['write'], tier: 'primary' }));

function isAdmin(role: string | undefined): boolean {
    return isAdminRole(role);
}

function errorResponse(message: string, code: 'FORBIDDEN' | 'NOT_FOUND') {
    return {
        success: false as const,
        error: { message, code },
    };
}

function serializeBlock(block: typeof calendarBlocks.$inferSelect) {
    return {
        ...block,
        createdAt: safeISODate(block.createdAt),
        updatedAt: safeISODate(block.updatedAt),
    };
}

async function tenantUserExists(
    db: AppDrizzle,
    tenantId: string,
    userId: string,
): Promise<boolean> {
    const user = await db.select({ id: users.id })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)))
        .get();
    return Boolean(user);
}

const app = createApiRouter();
app.openapi(createBlockRoute, async (c) => {
    const user = c.get('user');
    const tenantId = c.get('tenantId');
    const role = c.get('userRole');
    const input = c.req.valid('json');
    const targetUserId = input.userId ?? user.sub;

    if (!isAdmin(role) && targetUserId !== user.sub) {
        return c.json(errorResponse('Inspectors can only create their own calendar blocks', 'FORBIDDEN'), 403);
    }

    const db = getDrizzle(c);
    if (!await tenantUserExists(db, tenantId, targetUserId)) {
        return c.json(errorResponse('Target user not found', 'NOT_FOUND'), 404);
    }

    const now = new Date();
    const block = await db.insert(calendarBlocks).values({
        id: crypto.randomUUID(),
        tenantId,
        userId: targetUserId,
        title: input.title,
        date: input.date,
        startTime: input.allDay ? null : (input.startTime ?? null),
        endTime: input.allDay ? null : (input.endTime ?? null),
        allDay: input.allDay,
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now,
    }).returning().get();

    pushBlockAfterResponse(c, tenantId, block.id);
    const conflicts = await findTimeOffConflicts(db, tenantId, targetUserId, await resolveInspectionScope(c), block);
    return c.json({ success: true as const, data: { block: serializeBlock(block), conflicts } }, 201);
});
app.openapi(blockConflictsRoute, async (c) => {
    const user = c.get('user');
    const tenantId = c.get('tenantId');
    const query = c.req.valid('query');
    const targetUserId = query.userId ?? user.sub;
    if (targetUserId !== user.sub && !await canViewOthersCalendar(c)) {
        return c.json(errorResponse('Inspectors can only check their own calendar', 'FORBIDDEN'), 403);
    }
    const conflicts = await findTimeOffConflicts(getDrizzle(c), tenantId, targetUserId, await resolveInspectionScope(c), {
        date: query.date, allDay: query.allDay === 'true', startTime: query.startTime, endTime: query.endTime,
    });
    return c.json({ success: true as const, data: { conflicts } }, 200);
});
app.openapi(listBlocksRoute, async (c) => {
    const user = c.get('user');
    const tenantId = c.get('tenantId');
    const query = c.req.valid('query');
    const targetUserId = query.userId ?? user.sub;

    if (targetUserId !== user.sub && !await canViewOthersCalendar(c)) {
        return c.json(errorResponse('Inspectors can only list their own calendar blocks', 'FORBIDDEN'), 403);
    }

    const rows = await getDrizzle(c).select()
        .from(calendarBlocks)
        .where(and(
            eq(calendarBlocks.tenantId, tenantId),
            eq(calendarBlocks.userId, targetUserId),
            gte(calendarBlocks.date, query.start),
            lte(calendarBlocks.date, query.end),
        ))
        .orderBy(asc(calendarBlocks.date), asc(calendarBlocks.startTime), asc(calendarBlocks.id));

    return c.json({
        success: true as const,
        data: { blocks: rows.map(serializeBlock) },
    }, 200);
});
app.openapi(updateBlockRoute, async (c) => {
    const user = c.get('user');
    const tenantId = c.get('tenantId');
    const role = c.get('userRole');
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const db = getDrizzle(c);
    const existing = await db.select().from(calendarBlocks)
        .where(and(eq(calendarBlocks.tenantId, tenantId), eq(calendarBlocks.id, id)))
        .get();

    if (!existing) {
        return c.json(errorResponse('Calendar block not found', 'NOT_FOUND'), 404);
    }
    if (!isAdmin(role) && existing.userId !== user.sub) {
        return c.json(errorResponse('Inspectors can only update their own calendar blocks', 'FORBIDDEN'), 403);
    }

    const targetUserId = input.userId ?? existing.userId;
    if (!isAdmin(role) && targetUserId !== user.sub) {
        return c.json(errorResponse('Inspectors cannot reassign calendar blocks', 'FORBIDDEN'), 403);
    }
    if (input.userId && !await tenantUserExists(db, tenantId, targetUserId)) {
        return c.json(errorResponse('Target user not found', 'NOT_FOUND'), 404);
    }

    const updates: Partial<typeof calendarBlocks.$inferInsert> = {
        updatedAt: new Date(),
    };
    if (input.userId !== undefined) updates.userId = input.userId;
    if (input.title !== undefined) updates.title = input.title;
    if (input.date !== undefined) updates.date = input.date;
    if (input.notes !== undefined) updates.notes = input.notes;
    if (input.allDay !== undefined) {
        updates.allDay = input.allDay;
        if (input.allDay) {
            updates.startTime = null;
            updates.endTime = null;
        }
    }
    if (input.allDay !== true && input.startTime !== undefined) updates.startTime = input.startTime;
    if (input.allDay !== true && input.endTime !== undefined) updates.endTime = input.endTime;

    const block = await db.update(calendarBlocks)
        .set(updates)
        .where(and(eq(calendarBlocks.tenantId, tenantId), eq(calendarBlocks.id, id)))
        .returning()
        .get();

    pushBlockAfterResponse(c, tenantId, block.id);
    const conflicts = await findTimeOffConflicts(db, tenantId, block.userId, await resolveInspectionScope(c), block);
    return c.json({ success: true as const, data: { block: serializeBlock(block), conflicts } }, 200);
});
app.openapi(deleteBlockRoute, async (c) => {
    const user = c.get('user');
    const tenantId = c.get('tenantId');
    const role = c.get('userRole');
    const { id } = c.req.valid('param');
    const db = getDrizzle(c);
    const existing = await db.select({ userId: calendarBlocks.userId })
        .from(calendarBlocks)
        .where(and(eq(calendarBlocks.tenantId, tenantId), eq(calendarBlocks.id, id)))
        .get();

    if (!existing) {
        return c.json(errorResponse('Calendar block not found', 'NOT_FOUND'), 404);
    }
    if (!isAdmin(role) && existing.userId !== user.sub) {
        return c.json(errorResponse('Inspectors can only delete their own calendar blocks', 'FORBIDDEN'), 403);
    }

    await db.delete(calendarBlocks)
        .where(and(eq(calendarBlocks.tenantId, tenantId), eq(calendarBlocks.id, id)));
    // Deleting the block here but leaving it on the owner's Google calendar
    // would leave them blocked by time off they just cancelled.
    dropExternalAfterResponse(c, tenantId, 'calendar_block', id);
    return c.json({ success: true as const }, 200);
});

/** Registration order. Drives the typed client; a test pins it to what `app` really registered. */
export const calendarBlockRouteConfigs = [
    createBlockRoute,
    blockConflictsRoute,
    listBlocksRoute,
    updateBlockRoute,
    deleteBlockRoute,
] as const;

export default app;
