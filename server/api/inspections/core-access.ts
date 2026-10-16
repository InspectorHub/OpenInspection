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
 *   Which other fields staff may write is decided by ./staff-order-guard.
 * - DELETE: needs the `deleteInspection` capability, and then owner, manager, the
 *   inspection's lead, or `scheduleOthers`. A helper can edit but cannot delete the
 *   lead's job.
 */
import { and, eq } from 'drizzle-orm';
import type { Context, Next } from 'hono';
import { Errors } from '../../lib/errors';
import { mayChangeSchedule, mayDeleteInspection } from '../../lib/inspection/assignment-access';
import { capabilitiesFor } from '../../lib/middleware/require-capability';
import { getDrizzle } from '../../lib/route-helpers';
import { invoices } from '../../lib/db/schema';
import { REPORT_STATUS } from '../../lib/status/report-status';
import { sameMoment } from '../../lib/inspection/order-fields';
import { assertStaffMayMove, assertStaffMayPatch, auditStaffOrderEdit } from './staff-order-guard';
import type { HonoConfig } from '../../types/hono';

export async function guardPatchReschedule(c: Context<HonoConfig>, next: Next) {
    const body = (await c.req.json().catch(() => null)) as { inspectorId?: unknown; date?: unknown } | null;
    // Staff run the booking: the order fields are theirs, nothing on the inspection side (./staff-order-guard).
    const staffChanged = body && typeof body === 'object' && c.get('userRole') === 'staff'
        ? await assertStaffMayPatch(c, c.req.param('id') ?? '', body as Record<string, unknown>)
        : null;
    if (body && (('inspectorId' in body) || typeof body.date === 'string')) {
        const { inspection } = await c.var.services.inspection.getInspection(c.req.param('id') ?? '', c.get('tenantId'));
        const reassigns = 'inspectorId' in body && (body.inspectorId ?? null) !== (inspection.inspectorId ?? null);
        const moves = typeof body.date === 'string' && !sameMoment(inspection.date, body.date);
        if ((reassigns || moves) && !(await mayChangeSchedule(c, c.req.param('id') ?? '', reassigns))) {
            throw Errors.Forbidden("Requires the 'scheduleOthers' capability to change the assignee, or the date of an inspection you do not work");
        }
    }
    await next();
    if (staffChanged && c.res.ok) auditStaffOrderEdit(c, c.req.param('id') ?? '', staffChanged);
}

export async function guardInspectionDelete(c: Context<HonoConfig>, next: Next) {
    if (!(await capabilitiesFor(c)).deleteInspection) {
        throw Errors.Forbidden("Requires the 'deleteInspection' capability");
    }
    if (!(await mayDeleteInspection(c, c.req.param('id') ?? ''))) {
        throw Errors.Forbidden('Only the lead inspector of this inspection can delete it');
    }
    return next();
}

/** PATCH /:id/schedule: the same own-date rule; naming a lead or helpers is reassigning. */
export async function guardScheduleMove(c: Context<HonoConfig>, next: Next) {
    const body = (await c.req.json().catch(() => null)) as { leadInspectorId?: unknown; helperInspectorIds?: unknown } | null;
    const reassigns = body?.leadInspectorId !== undefined || body?.helperInspectorIds !== undefined;
    await assertStaffMayMove(c, [c.req.param('id') ?? '']);
    if (!(await mayChangeSchedule(c, c.req.param('id') ?? '', reassigns))) {
        throw Errors.Forbidden("Requires the 'scheduleOthers' capability to reassign, or to move an inspection you do not work");
    }
    return next();
}

/**
 * What the audit record of a delete says about the inspection that is gone: its
 * state and whether a report or an invoice existed, and nothing about the people.
 * The caller writes these into the record as a literal, which is what the audit
 * registry gate reads.
 */
export async function deleteFacts(
    c: Context<HonoConfig>,
    inspection: { status: string; reportStatus?: string | null },
    inspectionId: string,
): Promise<{ status: string; reportPublished: boolean; hadInvoice: boolean }> {
    const invoice = await getDrizzle(c).select({ id: invoices.id }).from(invoices)
        .where(and(eq(invoices.tenantId, c.get('tenantId')), eq(invoices.inspectionId, inspectionId))).get();
    return {
        status: inspection.status,
        reportPublished: inspection.reportStatus === REPORT_STATUS.PUBLISHED,
        hadInvoice: !!invoice,
    };
}
