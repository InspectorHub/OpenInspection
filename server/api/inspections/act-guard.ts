/**
 * Acting on an inspection one is not on is decided by `scheduleOthers`.
 *
 * Whoever is on the job (its lead, or a helper on the roster) may act on it; anyone else
 * needs `scheduleOthers`. Owners hold it pinned and managers by default, so they pass; a
 * manager whose `scheduleOthers` was switched off is treated like an inspector. This is the
 * one check in front of the lifecycle acts: cancel, restore, confirm, mark complete,
 * publish, unpublish, return, request payment and send an agreement. The predicate is
 * `mayActOnInspection`, also behind the send-report and send-SMS guards.
 */
import type { Context, Next } from 'hono';
import { and, eq } from 'drizzle-orm';
import { Errors } from '../../lib/errors';
import { deniedNeedsPermission } from '../../lib/permission-denied';
import { inspections } from '../../lib/db/schema';
import { getDrizzle } from '../../lib/route-helpers';
import { mayActOnInspection } from '../../lib/inspection/assignment-access';
import type { HonoConfig } from '../../types/hono';

const NOT_ON_THIS_INSPECTION = 'You are not on this inspection, so you cannot cancel, confirm, complete, publish, return or bill it, or send its agreement';

/**
 * Throws 403 unless the caller is on the inspection or holds `scheduleOthers`. An id that is not an
 * inspection of this company answers 404, as the handler would, rather than a 403 about a job that is not there.
 */
export async function assertMayActOnJob(c: Context<HonoConfig>, inspectionId: string): Promise<void> {
    if (await mayActOnInspection(c, inspectionId)) return;
    const exists = await getDrizzle(c).select({ id: inspections.id }).from(inspections)
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, c.get('tenantId')))).get();
    if (!exists) throw Errors.NotFound('Inspection not found');
    throw deniedNeedsPermission(c, 'scheduleOthers', NOT_ON_THIS_INSPECTION);
}

/** Route middleware for a path with `:id` / `{id}` as the inspection. */
export async function guardActOnJob(c: Context<HonoConfig>, next: Next) {
    await assertMayActOnJob(c, c.req.param('id') ?? '');
    return next();
}
