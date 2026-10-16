/**
 * The status moves an office user (staff) may make: confirm a booking, cancel one
 * that has not been paid for or started, and bring a cancelled one back.
 *
 * Confirm, cancel and restore all write `status`, and `completed` belongs to the
 * inspector. Cancelling a paid job moves money (fee, refund, a credit memo), so
 * that stays with the owner and manager. Every move also needs `scheduleOthers`
 * or a place on the inspection, the same rule as the booking fields.
 *
 * Other roles pass straight through: nothing here changes what they can do.
 */
import type { Context, Next } from 'hono';
import { Errors } from '../../lib/errors';
import { getDrizzle } from '../../lib/route-helpers';
import { mayActOnInspection } from '../../lib/inspection/assignment-access';
import { loadInspectionStarted } from '../../lib/inspection/inspection-started';
import { recordedStatusBeforeCancel } from '../../lib/inspection/cancel-restore';
import { INSPECTION_STATUS } from '../../lib/status/inspection-status';
import type { HonoConfig } from '../../types/hono';

const isStaff = (c: Context<HonoConfig>) => c.get('userRole') === 'staff';

async function assertWorksOrSchedulesOthers(c: Context<HonoConfig>, id: string): Promise<void> {
    if (!(await mayActOnInspection(c, id))) {
        throw Errors.Forbidden("Requires the 'scheduleOthers' capability to change an inspection you do not work");
    }
}

/** POST /:id/confirm: staff confirm a booking, never reopen a completed visit. */
export async function guardStaffConfirm(c: Context<HonoConfig>, next: Next) {
    if (isStaff(c)) {
        const id = c.req.param('id') ?? '';
        const { inspection } = await c.var.services.inspection.getInspection(id, c.get('tenantId'));
        if (inspection.status === INSPECTION_STATUS.COMPLETED) {
            throw Errors.Forbidden('Office staff cannot change the status of a completed inspection');
        }
        await assertWorksOrSchedulesOthers(c, id);
    }
    return next();
}

/**
 * POST /:id/cancel, called once the cancellation has been quoted: staff cancel only a
 * job nothing has been collected on and the inspector has not started.
 */
export async function assertStaffMayCancel(c: Context<HonoConfig>, id: string, collectedCents: number): Promise<void> {
    if (!isStaff(c)) return;
    const tenantId = c.get('tenantId');
    const { inspection } = await c.var.services.inspection.getInspection(id, tenantId);
    await assertWorksOrSchedulesOthers(c, id);
    const reportStatus = inspection.reportStatus;
    if (await loadInspectionStarted(getDrizzle(c), tenantId, { id, status: inspection.status, reportStatus })) {
        throw Errors.Forbidden('Office staff cannot cancel an inspection that has started');
    }
    if (collectedCents > 0 || inspection.paymentStatus !== 'unpaid') {
        throw Errors.Forbidden('A payment has been collected on this inspection, so an owner or manager has to cancel it');
    }
}

/**
 * POST /:id/uncancel: staff restore a cancelled booking only when the cancellation
 * recorded the status it left, and that status was not `completed`. A cancellation with
 * no record (written before the status was kept, or whose record was lost) cannot say
 * what it was, and restoring a finished visit as a scheduled one is the one thing staff
 * must not do; an owner or manager restores those from what the row still says.
 */
export async function guardStaffUncancel(c: Context<HonoConfig>, next: Next) {
    if (isStaff(c)) {
        const id = c.req.param('id') ?? '';
        const tenantId = c.get('tenantId');
        const { inspection } = await c.var.services.inspection.getInspection(id, tenantId);
        await assertWorksOrSchedulesOthers(c, id);
        // Only a cancelled job has a "before"; anything else is left to the service to refuse.
        if (inspection.status === INSPECTION_STATUS.CANCELLED) {
            const before = await recordedStatusBeforeCancel(getDrizzle(c), tenantId, id);
            if (before === null || before === INSPECTION_STATUS.COMPLETED) {
                throw Errors.Forbidden('An owner or manager has to restore this inspection: it may have been completed before it was cancelled');
            }
        }
    }
    return next();
}
