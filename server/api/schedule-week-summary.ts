import { createRoute } from '@hono/zod-openapi';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { requireRole } from '../lib/middleware/rbac';
import { createApiRouter } from '../lib/openapi-router';
import { availability, availabilityOverrides } from '../lib/db/schema';
import {
    loadCustomHolidaysInRange,
    loadTenantHolidayConfig,
    resolveCompanyClosedDatesInRange,
} from '../lib/holidays/load-tenant-holidays';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import {
    WeekSummaryErrorSchema,
    WeekSummaryQuerySchema,
    WeekSummaryResponseSchema,
} from '../lib/validations/schedule-week-summary.schema';
import { BookingService } from '../services/booking.service';

const WEEK_LENGTH = 7;
const DAY_MS = 86_400_000;

type DayStatus = 'open' | 'full' | 'closed' | 'unconfigured';

/** Civil-date arithmetic: no timezone is involved, so UTC is just the calendar. */
function civilUtcMs(date: string): number {
    return Date.UTC(
        Number(date.slice(0, 4)),
        Number(date.slice(5, 7)) - 1,
        Number(date.slice(8, 10)),
    );
}

function addCivilDays(date: string, days: number): string {
    const d = new Date(civilUtcMs(date) + days * DAY_MS);
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${d.getUTCFullYear()}-${month}-${day}`;
}

function civilDayOfWeek(date: string): number {
    return new Date(civilUtcMs(date)).getUTCDay();
}

function isAdmin(role: string | undefined): boolean {
    return role === 'owner' || role === 'manager';
}

const allowedRoles = requireRole('owner', 'manager', 'inspector');

const weekSummaryRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/week-summary',
    operationId: 'getScheduleWeekSummary',
    tags: ['calendar'],
    summary: 'Summarize seven days of availability',
    description: 'Returns one availability status per civil day for the week beginning at start, batching the shared per-week setup into a single call. Owners and managers may summarize any inspector via userId; inspectors are always summarized against themselves.',
    middleware: [allowedRoles],
    request: {
        query: WeekSummaryQuerySchema,
    },
    responses: {
        200: {
            content: { 'application/json': { schema: WeekSummaryResponseSchema } },
            description: 'Seven day statuses in chronological order',
        },
        400: {
            content: { 'application/json': { schema: WeekSummaryErrorSchema } },
            description: 'Invalid start date or user selection',
        },
    },
    security: [{ bearerAuth: [] }],
}, { scopes: ['read'], tier: 'primary' }));

const scheduleWeekSummaryRoutes = createApiRouter()
    .openapi(weekSummaryRoute, async (c) => {
        const user = c.get('user');
        const role = c.get('userRole');
        const tenantId = c.get('tenantId');
        const query = c.req.valid('query');

        // Inspectors only ever see themselves, whatever userId they ask for.
        const scopedUserId = isAdmin(role) ? query.userId : user.sub;

        const dates = Array.from(
            { length: WEEK_LENGTH },
            (_, i) => addCivilDays(query.start, i),
        );
        const start = dates[0];
        const end = dates[WEEK_LENGTH - 1];

        const service = new BookingService(c.env.DB);
        const db = drizzle(c.env.DB);

        // Day-invariant setup resolved once for the whole week rather than per day.
        const [allQualified, holidayConfig, customHolidays] = await Promise.all([
            service.getQualifiedInspectorIds(tenantId, []),
            loadTenantHolidayConfig(c.env.DB, tenantId),
            loadCustomHolidaysInRange(c.env.DB, tenantId, start, end),
        ]);
        const qualified = scopedUserId
            ? allQualified.filter((id) => id === scopedUserId)
            : allQualified;

        const closedDates = resolveCompanyClosedDatesInRange({
            region: holidayConfig.holidayRegion,
            customRows: customHolidays,
            startDate: start,
            endDate: end,
        });

        // One range read each, then grouped in memory — a day counts as
        // configured when a recurring window covers its weekday or an additive
        // override opens it. This distinction is what separates `full` (hours
        // exist, nothing bookable) from `unconfigured` (no hours at all); the
        // slot engine collapses both to an empty slot list.
        const [windows, overrides] = qualified.length === 0
            ? [[], []]
            : await Promise.all([
                db.select({ dayOfWeek: availability.dayOfWeek })
                    .from(availability)
                    .where(and(
                        eq(availability.tenantId, tenantId),
                        inArray(availability.inspectorId, qualified),
                    )).all(),
                db.select({
                    date: availabilityOverrides.date,
                    isAvailable: availabilityOverrides.isAvailable,
                })
                    .from(availabilityOverrides)
                    .where(and(
                        eq(availabilityOverrides.tenantId, tenantId),
                        inArray(availabilityOverrides.inspectorId, qualified),
                        gte(availabilityOverrides.date, start),
                        lte(availabilityOverrides.date, end),
                    )).all(),
            ]);

        const configuredDays = new Set(windows.map((w) => w.dayOfWeek));
        const openedDates = new Set(
            overrides.filter((o) => o.isAvailable).map((o) => o.date),
        );

        const days = await Promise.all(dates.map(async (date): Promise<{
            date: string;
            status: DayStatus;
            label?: string;
        }> => {
            const holidayName = closedDates.get(date);
            if (holidayName) {
                return { date, status: 'closed', label: holidayName };
            }
            const configured = configuredDays.has(civilDayOfWeek(date))
                || openedDates.has(date);
            if (!configured) {
                return { date, status: 'unconfigured' };
            }
            // qualified is precomputed above, so the slot engine never re-resolves it.
            const { slots } = await service.getTenantSlots(tenantId, date, [], qualified);
            return { date, status: slots.some((s) => s.available) ? 'open' : 'full' };
        }));

        return c.json({ success: true as const, data: { days } }, 200);
    });

export type ScheduleApi = typeof scheduleWeekSummaryRoutes;

export default scheduleWeekSummaryRoutes;
