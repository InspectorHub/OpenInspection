import { createRoute } from '@hono/zod-openapi';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { requireRole } from '../lib/middleware/rbac';
import { requireCapability } from '../lib/middleware/require-capability';
import { createApiRouter } from '../lib/openapi-router';
import { inspections, tenantConfigs, users } from '../lib/db/schema';
import { epochMsToWallClockHm, epochMsToWallClockYmd, resolveTenantTimeZone } from '../lib/tz';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import {
    CalendarItemsErrorSchema,
    CalendarItemsResponseSchema,
    DispatchBoardQuerySchema,
    DispatchBoardResponseSchema,
    ListCalendarItemsQuerySchema,
} from '../lib/validations/calendar-items.schema';
import { listCalendarItems, type CalendarItem } from '../services/calendar-items.service';
import { getDrizzle } from '../lib/route-helpers';
import { isAdminRole } from '../lib/auth/roles';

/** Viewer's calendar display tz: their own override, else the tenant default. */
async function resolveEffectiveTz(database: D1Database, tenantId: string, userId: string): Promise<string> {
    const db = drizzle(database);
    const [userRow, cfg] = await Promise.all([
        db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId)).get(),
        db.select({ defaultTimezone: tenantConfigs.defaultTimezone })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get(),
    ]);
    return resolveTenantTimeZone(userRow?.timezone ?? cfg?.defaultTimezone);
}

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

/**
 * GET /api/calendar/dispatch — one round trip for the whole board.
 *
 * It lives beside the items feed because it IS the items feed: the same
 * `listCalendarItems` call, one day wide, plus the roster the columns are keyed
 * by and the tenant's conflict policy. Assembling those three in the browser
 * would mean three sequential loader fetches for a view whose whole point is
 * that it renders a day at a glance.
 *
 * Gated on `requireCapability('scheduleOthers')`, matching the write it feeds
 * (PATCH /api/inspections/:id/schedule). Reading the whole team's day and
 * rearranging it are the same privilege, and the capability is toggleable in
 * both directions where a role tier is not.
 */
const dispatchRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/dispatch',
    operationId: 'getDispatchBoard',
    tags: ['calendar'],
    summary: 'Dispatch board feed for one day',
    description: 'Returns the inspector roster, every calendar item on the given civil date, the unassigned subset, and the tenant booking_conflict_policy in a single response.',
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('scheduleOthers')] as const,
    request: { query: DispatchBoardQuerySchema },
    responses: {
        200: {
            content: { 'application/json': { schema: DispatchBoardResponseSchema } },
            description: 'Board payload for the requested day',
        },
        403: {
            content: { 'application/json': { schema: CalendarItemsErrorSchema } },
            description: 'The caller lacks the scheduleOthers capability',
        },
    },
    security: [{ bearerAuth: [] }],
}, { scopes: ['read'], tier: 'extended', capability: 'scheduleOthers' }));

const SCHEDULING_ROLES = ['owner', 'manager', 'inspector'] as const;

function errorResponse(message: string, code: 'FORBIDDEN') {
    return {
        success: false as const,
        error: { message, code },
    };
}

function isAdmin(role: string | undefined): boolean {
    return isAdminRole(role);
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

        const effectiveTz = await resolveEffectiveTz(c.env.DB, tenantId, user.sub);
        const items = await listCalendarItems(c.env.DB, tenantId, {
            start: query.start,
            end: query.end,
            effectiveTz,
            ...(userIds ? { userIds } : {}),
        });

        return c.json({
            success: true as const,
            data: { items },
        }, 200);
    })
    .openapi(dispatchRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const db = getDrizzle(c);

        const cfg = await db.select({
            defaultTimezone: tenantConfigs.defaultTimezone,
            bookingConflictPolicy: tenantConfigs.bookingConflictPolicy,
        })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        const tenantTz = resolveTenantTimeZone(cfg?.defaultTimezone);
        const conflictPolicy: 'advisory' | 'block' =
            cfg?.bookingConflictPolicy === 'block' ? 'block' : 'advisory';

        // The board is a TENANT-timezone artifact, not a viewer one: two people
        // dispatching the same company must be looking at the same day and the
        // same column positions, or a drag means different things to each.
        const date = c.req.valid('query').date ?? epochMsToWallClockYmd(Date.now(), tenantTz);

        const roster = await db.select({
            id: users.id,
            name: users.name,
            email: users.email,
            role: users.role,
        })
            .from(users)
            .where(and(
                eq(users.tenantId, tenantId),
                isNull(users.deletedAt),
                inArray(users.role, [...SCHEDULING_ROLES]),
            ))
            .orderBy(asc(users.name), asc(users.email))
            .all();

        const items = await listCalendarItems(c.env.DB, tenantId, {
            start: date,
            end: date,
            effectiveTz: tenantTz,
        });

        // The items feed reports inspections as all-day, which is all a month
        // grid needs. A board places cards on a time axis, so the precise
        // instant is fetched here and layered on. Keyed by DATE rather than by
        // `inArray(ids)` on purpose — a busy day can exceed D1's 100-bind-param
        // ceiling, and the date predicate costs two binds regardless of volume.
        // Every column is projected explicitly for the same reason the 100-column
        // result cap exists: `select()` on this table would spend most of it.
        const timedRows = await db.select({
            id: inspections.id,
            scheduledStartMs: inspections.scheduledStartMs,
            scheduledEndMs: inspections.scheduledEndMs,
            durationMin: inspections.durationMin,
        })
            .from(inspections)
            .where(and(
                eq(inspections.tenantId, tenantId),
                sql`date(${inspections.date}) = ${date}`,
            ))
            .all();

        const timed = new Map(timedRows.map((r) => [r.id, r]));
        const toMs = (v: unknown): number | null =>
            v instanceof Date ? v.getTime() : v == null ? null : Number(v);

        const boardItems: CalendarItem[] = items.map((item) => {
            if (item.kind !== 'inspection') return item;
            const row = timed.get(item.id);
            const startMs = toMs(row?.scheduledStartMs);
            if (startMs == null) return item;
            const endMs = toMs(row?.scheduledEndMs);
            return {
                ...item,
                allDay: false,
                startTime: epochMsToWallClockHm(startMs, tenantTz),
                ...(endMs != null ? { endTime: epochMsToWallClockHm(endMs, tenantTz) } : {}),
                meta: {
                    ...item.meta,
                    scheduledStartMs: startMs,
                    scheduledEndMs: endMs,
                    durationMin: row?.durationMin ?? null,
                },
            };
        });

        // "Unassigned" is the absence of a userId on the item, which
        // listCalendarItems already resolves through the link table with the
        // legacy inspector_id column as fallback. Re-deriving that rule here
        // would be a second place for it to be applied differently.
        const unassigned = boardItems.filter((i) => i.kind === 'inspection' && !i.userId);

        return c.json({
            success: true as const,
            data: { date, conflictPolicy, inspectors: roster, items: boardItems, unassigned },
        }, 200);
    });

export default calendarItemsRoutes;
