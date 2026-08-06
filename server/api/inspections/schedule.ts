// PATCH /api/inspections/:id/schedule — move an inspection in time and across
// people in ONE write.
//
// Why this is not the generic PATCH /{id}: that route takes a civil `date` and
// derives the instant from it, which is the right shape for a settings sheet
// but the wrong one for a dispatch board. A board drags to 10:30, not to a day,
// and the instant is what conflict detection reads. Here the epoch millisecond
// is AUTHORITATIVE and the civil `date` column is derived from it in the tenant
// timezone, so the two can never diverge.
//
// The guard is `requireCapability('scheduleOthers')`, not a role test. Deciding
// where someone else's day goes is exactly the act that capability names, and
// it is TOGGLEABLE: an inspector granted the override may dispatch, and a
// manager whose override was revoked may not. A role tier cannot express either.
import { createRoute, z } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { requireCapability } from '../../lib/middleware/require-capability';
import { auditFromContext } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import { inspections as inspectionTable, tenantConfigs, users } from '../../lib/db/schema';
import { getInspectionRoster } from '../../lib/inspection/roster';
import { syncAssignmentsAndSplits } from '../../services/pay-split.service';
import { findScheduleConflicts } from '../../lib/schedule-conflicts';
import { resolveInternalHolidayEffect } from '../../lib/holidays/load-tenant-holidays';
import { epochMsToWallClockHm, epochMsToWallClockYmd, resolveTenantTimeZone } from '../../lib/tz';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { getDrizzle } from '../../lib/route-helpers';
import {
    ReschedulePatchSchema,
    RescheduleResponseSchema,
    ScheduleErrorSchema,
} from '../../lib/validations/schedule.schema';

const scheduleRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/{id}/schedule',
    tags: ['inspections'],
    summary: 'Reschedule and/or reassign one inspection',
    description: 'Moves an inspection to a precise instant and optionally changes who works it. The epoch-millisecond start is authoritative; the civil date is derived from it in the tenant timezone. Returns 409 when the tenant booking_conflict_policy is "block" and the resulting assignment overlaps existing work.',
    request: {
        params: z.object({
            id: z.string().trim().min(1).describe('Inspection id to reschedule.'),
        }).describe('Path parameters.'),
        body: {
            content: { 'application/json': { schema: ReschedulePatchSchema } },
        },
    },
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('scheduleOthers')] as const,
    responses: {
        200: {
            content: { 'application/json': { schema: RescheduleResponseSchema } },
            description: 'Rescheduled; any advisory conflicts ride along in the payload',
        },
        400: {
            content: { 'application/json': { schema: ScheduleErrorSchema } },
            description: 'Unknown inspector for this tenant, or a blocked company holiday',
        },
        404: {
            content: { 'application/json': { schema: ScheduleErrorSchema } },
            description: 'No such inspection in this tenant',
        },
        409: {
            content: { 'application/json': { schema: ScheduleErrorSchema } },
            description: 'Overlap detected and the tenant booking_conflict_policy is "block"',
        },
    },
    operationId: 'rescheduleInspection',
}, { scopes: ['write'], tier: 'extended', capability: 'scheduleOthers' }));

const toMs = (v: unknown): number | null =>
    v instanceof Date ? v.getTime() : v == null ? null : Number(v);

const scheduleRoutes = createApiRouter()
    .openapi(scheduleRoute, async (c) => {
        const { id } = c.req.valid('param');
        const body = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const db = getDrizzle(c);

        const row = await db.select({
            date: inspectionTable.date,
            scheduledStartMs: inspectionTable.scheduledStartMs,
            scheduledEndMs: inspectionTable.scheduledEndMs,
            durationMin: inspectionTable.durationMin,
        })
            .from(inspectionTable)
            .where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId)))
            .get();
        if (!row) throw Errors.NotFound('Inspection not found');

        const cfg = await db.select({
            defaultTimezone: tenantConfigs.defaultTimezone,
            bookingConflictPolicy: tenantConfigs.bookingConflictPolicy,
        })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        const tz = resolveTenantTimeZone(cfg?.defaultTimezone);
        const policy = cfg?.bookingConflictPolicy === 'block' ? 'block' : 'advisory';

        const startMs = body.scheduledStartMs;
        const civilDate = epochMsToWallClockYmd(startMs, tz);
        const hm = epochMsToWallClockHm(startMs, tz);

        // Same closed-day rule the create path enforces. A reschedule ONTO a
        // blocked company holiday is the same act as booking one, and a board
        // that could sidestep the policy by dragging would make the setting a
        // suggestion.
        const holiday = await resolveInternalHolidayEffect(c.env.DB, tenantId, civilDate);
        if (holiday.effect === 'block') {
            return c.json({
                success: false as const,
                error: {
                    code: 'HOLIDAY_BLOCKED',
                    message: holiday.name
                        ? `Cannot schedule on ${holiday.name} — company holidays are blocked.`
                        : 'Cannot schedule on a company closed day.',
                },
            }, 400);
        }

        // Assignment intent. Absent keys mean "leave it alone", so the current
        // roster supplies the other half — syncInspectionAssignments is a FULL
        // REPLACE, and passing only the lead would silently drop the helpers.
        const touchesAssignment = body.leadInspectorId !== undefined || body.helperInspectorIds !== undefined;
        const roster = await getInspectionRoster(db, tenantId, id);
        const leadId = body.leadInspectorId !== undefined
            ? body.leadInspectorId
            : roster.lead?.id ?? null;
        const helperIds = body.helperInspectorIds ?? roster.helpers.map((h) => h.id);

        // An id naming a user is not the same as an id naming one of OUR users.
        // Resolve every proposed assignee inside the caller's tenant before it
        // reaches the link table, exactly as the generic PATCH resolves
        // inspectorId (a UUID from another tenant is still a UUID).
        if (touchesAssignment) {
            for (const candidate of [leadId, ...helperIds]) {
                if (!candidate) continue;
                const member = await db.select({ id: users.id }).from(users)
                    .where(and(eq(users.id, candidate), eq(users.tenantId, tenantId)))
                    .get();
                if (!member) {
                    return c.json({
                        success: false as const,
                        error: { code: 'INVALID_INSPECTOR', message: 'An assignee is not a member of this tenant' },
                    }, 400);
                }
            }
        }

        // Duration resolution, most specific first: what the caller sent, else
        // the span the row already carried, else its stored durationMin. Nothing
        // is invented — a row with no resolvable duration keeps a null end and
        // conflict detection degrades to the hour bucket, which is what it
        // already did for that row.
        const oldStart = toMs(row.scheduledStartMs);
        const oldEnd = toMs(row.scheduledEndMs);
        const spanMin = oldStart != null && oldEnd != null ? Math.round((oldEnd - oldStart) / 60_000) : null;
        const durationMin = body.durationMin ?? spanMin ?? row.durationMin ?? null;
        const endMs = durationMin != null ? startMs + durationMin * 60_000 : null;

        const conflicts: Array<{ inspectionId: string; propertyAddress: string; date: string; inspectorId: string }> = [];
        const assignees = [leadId, ...helperIds].filter((v): v is string => Boolean(v));
        for (const inspectorId of assignees) {
            const found = await findScheduleConflicts(
                db,
                tenantId,
                inspectorId,
                `${civilDate}T${hm}`,
                id,
                { startMs, endMs },
            );
            for (const hit of found) conflicts.push({ ...hit, inspectorId });
        }

        if (policy === 'block' && conflicts.length > 0) {
            return c.json({
                success: false as const,
                error: {
                    code: 'SCHEDULE_CONFLICT',
                    message: 'That slot overlaps existing work and this company blocks double-booking.',
                    conflicts,
                },
            }, 409);
        }

        // Rows whose `date` carried a time suffix keep one — the HH:MM busy
        // checks read it via slice(11,16), and truncating here would blind them.
        const dateValue = row.date.length > 10 ? `${civilDate}T${hm}` : civilDate;
        const values: Record<string, unknown> = {
            date: dateValue,
            scheduledStartMs: new Date(startMs),
            scheduledEndMs: endMs != null ? new Date(endMs) : null,
        };
        if (durationMin != null) values.durationMin = durationMin;
        // The legacy column is not a second authority, but it IS the fallback
        // readers use when the link table has no row — so an explicit unassign
        // has to clear it, or the board would keep showing the old inspector on
        // a card it just dropped into the unassigned lane.
        if (body.leadInspectorId !== undefined) values.inspectorId = leadId;

        await db.update(inspectionTable).set(values)
            .where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId)));

        if (touchesAssignment) {
            await syncAssignmentsAndSplits(db, tenantId, id, {
                leadInspectorId: leadId,
                helperInspectorIds: helperIds,
            });
        }

        auditFromContext(c, 'inspection.rescheduled', 'inspection', {
            entityId: id,
            metadata: {
                from: { date: row.date, scheduledStartMs: oldStart },
                to: { date: dateValue, scheduledStartMs: startMs },
                ...(touchesAssignment ? { leadInspectorId: leadId } : {}),
                conflicts: conflicts.length,
            },
        });

        return c.json({
            success: true as const,
            data: {
                date: dateValue,
                scheduledStartMs: startMs,
                scheduledEndMs: endMs,
                durationMin,
                conflicts,
            },
        }, 200);
    });

export default scheduleRoutes;
