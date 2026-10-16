/**
 * What an office user (staff) may write through `PATCH /api/inspections/:id`.
 *
 * Staff run the booking, not the inspection: the order fields are theirs, the
 * inspection-side fields (report look, signature switch, the property facts once the
 * inspection has started) are not. The field lists and the rule live in
 * `lib/inspection/order-fields`; this applies them to a request. It runs ahead of the
 * handler so a refused body writes nothing, and it never runs for any other role.
 *
 * PATCH writes `status` straight to the row, without the status service, so the
 * status rules (never out of `completed`, order statuses only) are enforced here.
 */
import type { Context } from 'hono';
import { Errors } from '../../lib/errors';
import { auditFromContext } from '../../lib/audit';
import { getDrizzle } from '../../lib/route-helpers';
import { classifyStaffPatch, type StaffPatchRefusal } from '../../lib/inspection/order-fields';
import { loadInspectionStarted } from '../../lib/inspection/inspection-started';
import { mayActOnInspection } from '../../lib/inspection/assignment-access';
import type { HonoConfig } from '../../types/hono';

const REFUSAL_TEXT: Record<StaffPatchRefusal, string> = {
    inspection_side_field: 'Office staff cannot change the report settings or other inspection fields',
    attribute_locked: 'The property details can no longer be changed by office staff once the inspection has started',
    started_locked: 'The inspector, address and date can no longer be changed by office staff once the inspection has started',
    status_regress: 'Office staff cannot change the status of a completed inspection',
    status_not_order: 'Office staff can set a status of requested, scheduled or confirmed only',
    gate_off: 'Office staff can turn the payment and agreement requirements on, not off',
};

/** Date and inspector changes have their own capability check in the schedule guard. */
const SCHEDULE_KEYS: ReadonlySet<string> = new Set(['date', 'inspectorId']);

/** Refuses the body (403, nothing written) or returns the keys it changes. */
export async function assertStaffMayPatch(c: Context<HonoConfig>, id: string, body: Record<string, unknown>): Promise<string[]> {
    const tenantId = c.get('tenantId');
    const { inspection } = await c.var.services.inspection.getInspection(id, tenantId);
    const started = await loadInspectionStarted(getDrizzle(c), tenantId, { id, status: inspection.status, reportStatus: inspection.reportStatus });
    const verdict = classifyStaffPatch(body, {
        status: inspection.status,
        reportStatus: inspection.reportStatus,
        started,
        paymentRequired: !!inspection.paymentRequired,
        agreementRequired: !!inspection.agreementRequired,
        stored: inspection as Record<string, unknown>,
    });
    if (!verdict.ok) throw Errors.Forbidden(`${REFUSAL_TEXT[verdict.reason]} (${verdict.keys.join(', ')})`);

    // The order fields below the schedule are written on a job one works, or with scheduleOthers.
    if (verdict.changed.some((key) => !SCHEDULE_KEYS.has(key))) {
        if (!(await mayActOnInspection(c, id))) {
            throw Errors.Forbidden("Requires the 'scheduleOthers' capability to change the booking of an inspection you do not work");
        }
    }
    return verdict.changed;
}

/** The record of an office user's order edit: which fields, never their values. Status moves have their own row. */
export function auditStaffOrderEdit(c: Context<HonoConfig>, id: string, changed: readonly string[]): void {
    const fields = changed.filter((key) => key !== 'status');
    if (fields.length === 0) return;
    auditFromContext(c, 'inspection.order_updated', 'inspection', {
        entityId: id,
        metadata: { fields: fields.join(','), count: fields.length },
    });
}
