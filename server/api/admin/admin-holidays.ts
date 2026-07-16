import { createRoute } from '@hono/zod-openapi';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { tenantCustomHolidays } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import {
    loadCustomHolidaysForYear,
    loadTenantHolidayConfig,
    resolveInternalHolidayEffect,
} from '../../lib/holidays/load-tenant-holidays';
import { resolveCompanyClosedDates } from '../../lib/holidays/resolve-closed-dates';
import { requireRole } from '../../lib/middleware/rbac';
import { createApiRouter } from '../../lib/openapi-router';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import {
    CreateCustomHolidaySchema,
    CustomHolidayErrorSchema,
    CustomHolidayListResponseSchema,
    CustomHolidayParamsSchema,
    CustomHolidayResponseSchema,
    DeleteCustomHolidayResponseSchema,
    HolidayCheckQuerySchema,
    HolidayCheckResponseSchema,
    HolidayPreviewQuerySchema,
    HolidayPreviewResponseSchema,
    ListCustomHolidaysQuerySchema,
} from '../../lib/validations/tenant-holidays.schema';

const adminRoles = requireRole('owner', 'manager');
const readRoles = requireRole('owner', 'manager', 'inspector');

function serializeHoliday(row: typeof tenantCustomHolidays.$inferSelect) {
    return { id: row.id, date: row.date, name: row.name };
}

const listRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/custom-holidays',
    operationId: 'listCustomHolidays',
    tags: ['admin'],
    summary: 'List tenant custom holidays',
    description: 'Returns custom company closed days for the holiday catalog.',
    middleware: [adminRoles] as const,
    request: { query: ListCustomHolidaysQuerySchema },
    responses: {
        200: {
            content: { 'application/json': { schema: CustomHolidayListResponseSchema } },
            description: 'Custom holidays',
        },
    },
}, { scopes: ['admin'], tier: 'extended' }));

const createRouteDef = createRoute(withMcpMetadata({
    method: 'post',
    path: '/custom-holidays',
    operationId: 'createCustomHoliday',
    tags: ['admin'],
    summary: 'Create a custom holiday',
    description: 'Adds a single-date custom closed day to the tenant holiday catalog.',
    middleware: [adminRoles] as const,
    request: {
        body: { content: { 'application/json': { schema: CreateCustomHolidaySchema } } },
    },
    responses: {
        201: {
            content: { 'application/json': { schema: CustomHolidayResponseSchema } },
            description: 'Created',
        },
        400: {
            content: { 'application/json': { schema: CustomHolidayErrorSchema } },
            description: 'Validation or conflict',
        },
    },
}, { scopes: ['admin'], tier: 'extended' }));

const deleteRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/custom-holidays/{id}',
    operationId: 'deleteCustomHoliday',
    tags: ['admin'],
    summary: 'Delete a custom holiday',
    description: 'Removes a custom closed day from the tenant holiday catalog.',
    middleware: [adminRoles] as const,
    request: { params: CustomHolidayParamsSchema },
    responses: {
        200: {
            content: { 'application/json': { schema: DeleteCustomHolidayResponseSchema } },
            description: 'Deleted',
        },
        404: {
            content: { 'application/json': { schema: CustomHolidayErrorSchema } },
            description: 'Not found',
        },
    },
}, { scopes: ['admin'], tier: 'extended' }));

const previewRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/holidays/preview',
    operationId: 'previewHolidays',
    tags: ['admin'],
    summary: 'Preview resolved closed dates for a year',
    description: 'Returns the union of federal, state, and custom holidays for the configured region. Readable by inspectors for the My Schedule company-closed strip.',
    middleware: [readRoles] as const,
    request: { query: HolidayPreviewQuerySchema },
    responses: {
        200: {
            content: { 'application/json': { schema: HolidayPreviewResponseSchema } },
            description: 'Resolved closed dates',
        },
    },
}, { scopes: ['read'], tier: 'extended' }));

const checkRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/holidays/check',
    operationId: 'checkInternalHoliday',
    tags: ['admin'],
    summary: 'Check internal holiday policy for a date',
    description: 'Used by the New Inspection wizard to show advisory/block UI for company closed days.',
    middleware: [readRoles] as const,
    request: { query: HolidayCheckQuerySchema },
    responses: {
        200: {
            content: { 'application/json': { schema: HolidayCheckResponseSchema } },
            description: 'Internal holiday effect',
        },
    },
}, { scopes: ['admin'], tier: 'extended' }));

const adminHolidayRoutes = createApiRouter()
    .openapi(listRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { year } = c.req.valid('query');
        const db = drizzle(c.env.DB);
        let rows;
        if (year) {
            const start = `${year}-01-01`;
            const end = `${year}-12-31`;
            rows = await db.select().from(tenantCustomHolidays).where(and(
                eq(tenantCustomHolidays.tenantId, tenantId),
                gte(tenantCustomHolidays.date, start),
                lte(tenantCustomHolidays.date, end),
            )).orderBy(asc(tenantCustomHolidays.date)).all();
        } else {
            rows = await db.select().from(tenantCustomHolidays).where(
                eq(tenantCustomHolidays.tenantId, tenantId),
            ).orderBy(asc(tenantCustomHolidays.date)).all();
        }
        return c.json({
            success: true as const,
            data: { holidays: rows.map(serializeHoliday) },
        }, 200);
    })
    .openapi(createRouteDef, async (c) => {
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        const db = drizzle(c.env.DB);
        const existing = await db.select({ id: tenantCustomHolidays.id })
            .from(tenantCustomHolidays)
            .where(and(
                eq(tenantCustomHolidays.tenantId, tenantId),
                eq(tenantCustomHolidays.date, body.date),
            ))
            .get();
        if (existing) {
            throw Errors.BadRequest('A custom holiday already exists on that date.', 'DUPLICATE_HOLIDAY');
        }
        const now = new Date();
        const id = crypto.randomUUID();
        await db.insert(tenantCustomHolidays).values({
            id,
            tenantId,
            date: body.date,
            name: body.name,
            createdAt: now,
            updatedAt: now,
        });
        return c.json({
            success: true as const,
            data: { holiday: { id, date: body.date, name: body.name } },
        }, 201);
    })
    .openapi(deleteRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const db = drizzle(c.env.DB);
        const row = await db.select().from(tenantCustomHolidays).where(and(
            eq(tenantCustomHolidays.tenantId, tenantId),
            eq(tenantCustomHolidays.id, id),
        )).get();
        if (!row) throw Errors.NotFound('Custom holiday not found.');
        await db.delete(tenantCustomHolidays).where(and(
            eq(tenantCustomHolidays.tenantId, tenantId),
            eq(tenantCustomHolidays.id, id),
        ));
        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    })
    .openapi(previewRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { year } = c.req.valid('query');
        const config = await loadTenantHolidayConfig(c.env.DB, tenantId);
        if (!config.holidayRegion) {
            return c.json({ success: true as const, data: { dates: [] } }, 200);
        }
        const custom = await loadCustomHolidaysForYear(c.env.DB, tenantId, year);
        const catalog = resolveCompanyClosedDates({
            region: config.holidayRegion,
            customRows: custom,
            year,
        });
        const dates = [...catalog.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, name]) => ({ date, name }));
        return c.json({ success: true as const, data: { dates } }, 200);
    })
    .openapi(checkRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { date } = c.req.valid('query');
        const result = await resolveInternalHolidayEffect(c.env.DB, tenantId, date);
        return c.json({
            success: true as const,
            data: { effect: result.effect, name: result.name },
        }, 200);
    });

export default adminHolidayRoutes;
