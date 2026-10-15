/**
 * Route-level guards for `PATCH /api/inspections/:id` and `DELETE /api/inspections/:id`.
 *
 * Both routes were open to any staff role for any inspection, which let an
 * inspector do through them what `PATCH /bulk` refuses without `scheduleOthers`:
 * move someone else's job to another date or person, or remove it.
 *
 * - PATCH: the DATE of an inspection one works (lead or helper) may be changed
 *   freely; changing the assigned inspector, or touching an inspection one is not
 *   on, requires `scheduleOthers`. A body that merely repeats the stored
 *   assignee/date is not a change - the settings sheet forwards its whole form.
 * - DELETE: owner, manager, the inspection's lead, or `scheduleOthers`. A helper
 *   can edit but cannot delete the lead's job.
 */
import type { Context, Next } from 'hono';
import { Errors } from '../../lib/errors';
import { mayChangeSchedule, mayDeleteInspection } from '../../lib/inspection/assignment-access';
import { safeISODate } from '../../lib/date';
import type { HonoConfig } from '../../types/hono';

/**
 * Is the submitted date the stored one? Same calendar day, and when the submission
 * carries a time it must equal the stored instant - a stored date-only value has no
 * time, so a submitted time is a change. A date-only submission keeps the stored time.
 */
function sameMoment(stored: unknown, submitted: string): boolean {
    const a = stored instanceof Date ? safeISODate(stored) : String(stored ?? '');
    if (a.slice(0, 10) !== submitted.slice(0, 10)) return false;
    if (submitted.length <= 10) return true;
    return a.length > 10 && Date.parse(a) === Date.parse(submitted);
}

export async function guardPatchReschedule(c: Context<HonoConfig>, next: Next) {
    const body = (await c.req.json().catch(() => null)) as { inspectorId?: unknown; date?: unknown } | null;
    if (!body || (!('inspectorId' in body) && typeof body.date !== 'string')) return next();

    const { inspection } = await c.var.services.inspection.getInspection(c.req.param('id') ?? '', c.get('tenantId'));
    const reassigns = 'inspectorId' in body && (body.inspectorId ?? null) !== (inspection.inspectorId ?? null);
    const moves = typeof body.date === 'string' && !sameMoment(inspection.date, body.date);
    if ((reassigns || moves) && !(await mayChangeSchedule(c, c.req.param('id') ?? '', reassigns))) {
        throw Errors.Forbidden("Requires the 'scheduleOthers' capability to change the assignee, or the date of an inspection you do not work");
    }
    return next();
}

export async function guardInspectionDelete(c: Context<HonoConfig>, next: Next) {
    if (!(await mayDeleteInspection(c, c.req.param('id') ?? ''))) {
        throw Errors.Forbidden('Only the lead inspector of this inspection can delete it');
    }
    return next();
}

/** PATCH /:id/schedule: the same own-date rule; naming a lead or helpers is reassigning. */
export async function guardScheduleMove(c: Context<HonoConfig>, next: Next) {
    const body = (await c.req.json().catch(() => null)) as { leadInspectorId?: unknown; helperInspectorIds?: unknown } | null;
    const reassigns = body?.leadInspectorId !== undefined || body?.helperInspectorIds !== undefined;
    if (!(await mayChangeSchedule(c, c.req.param('id') ?? '', reassigns))) {
        throw Errors.Forbidden("Requires the 'scheduleOthers' capability to reassign, or to move an inspection you do not work");
    }
    return next();
}
