/**
 * GET /api/schedule/day-slots — one day of slots, with the free inspectors named.
 *
 * A sibling of `schedule-week-summary.ts` rather than an extension of it: that
 * route answers "how does the WEEK look" in four statuses and deliberately
 * throws the slot detail away; this one answers "who could take a job at 10:30
 * on Tuesday". Same service call underneath (`getTenantSlots`), opposite
 * resolution.
 *
 * Gated on `requireCapability('scheduleOthers')` to match the rest of the
 * dispatch surface. Reading who else is free is the same privilege as putting
 * work on them, and unlike a role tier the capability is toggleable in both
 * directions.
 *
 * DURATION is not a parameter here on purpose. `getTenantSlots` reports slot
 * STARTS; whether a two-hour job fits at 10:30 is a question about consecutive
 * starts, answerable from this response alone. Pushing it into the service
 * would change a signature the public booking path also depends on, to compute
 * something the caller can already derive.
 */
import { createRoute } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { requireRole } from '../lib/middleware/rbac';
import { requireCapability } from '../lib/middleware/require-capability';
import { createApiRouter } from '../lib/openapi-router';
import { tenantConfigs } from '../lib/db/schema';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { getDrizzle } from '../lib/route-helpers';
import {
    DaySlotsErrorSchema,
    DaySlotsQuerySchema,
    DaySlotsResponseSchema,
} from '../lib/validations/schedule-day-slots.schema';
import { BookingService } from '../services/booking.service';

const daySlotsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/day-slots',
    operationId: 'getScheduleDaySlots',
    tags: ['calendar'],
    summary: 'Free slots for one day, naming the free inspectors',
    description: 'Returns every slot start on a civil date with the inspectors free at each, plus the tenant slot interval. Staff-only counterpart to the identity-hiding public booking slots endpoint.',
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('scheduleOthers')] as const,
    request: { query: DaySlotsQuerySchema },
    responses: {
        200: {
            content: { 'application/json': { schema: DaySlotsResponseSchema } },
            description: 'Slot starts for the requested day',
        },
        403: {
            content: { 'application/json': { schema: DaySlotsErrorSchema } },
            description: 'The caller lacks the scheduleOthers capability',
        },
    },
    security: [{ bearerAuth: [] }],
}, { scopes: ['read'], tier: 'extended', capability: 'scheduleOthers' }));

const scheduleDaySlotsRoutes = createApiRouter()
    .openapi(daySlotsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { date, userIds } = c.req.valid('query');
        const db = getDrizzle(c);

        const cfg = await db.select({
            bookingSlotIntervalMin: tenantConfigs.bookingSlotIntervalMin,
        })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();

        const service = new BookingService(c.env.DB);
        const allQualified = await service.getQualifiedInspectorIds(tenantId, []);
        // Narrowing INTERSECTS with the qualified set rather than replacing it:
        // an id the caller invented, or one belonging to somebody who cannot
        // take this work, must not become a free inspector by being asked for.
        const qualified = userIds
            ? allQualified.filter((id) => userIds.includes(id))
            : allQualified;

        const { slots, holidayAdvisory } = await service.getTenantSlots(tenantId, date, [], qualified);

        return c.json({
            success: true as const,
            data: {
                date,
                intervalMin: cfg?.bookingSlotIntervalMin ?? 30,
                slots,
                holidayAdvisory: holidayAdvisory ?? null,
            },
        }, 200);
    });

export default scheduleDaySlotsRoutes;
