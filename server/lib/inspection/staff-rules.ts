/**
 * The pure parts of what office staff may do to a job, in one place so the routes and the
 * hub page read the SAME functions. The routes apply them after loading the facts
 * (`api/inspections/staff-status-guards`); the page applies them to the facts it was
 * sent (`app/lib/hub-access`); the parity spec checks the page never offers what these refuse.
 */
import { INSPECTION_STATUS } from '../status/inspection-status';
import type { RestorableStatus } from './cancel-restore';

/** May this viewer act on this inspection: an owner or manager, someone working it, or someone with `scheduleOthers`. */
export function mayActOn(who: { isAdmin: boolean; onJob: boolean; scheduleOthers: boolean }): boolean {
    return who.isAdmin || who.onJob || who.scheduleOthers;
}

/** Staff cancel only a job the inspector has not started and nothing has been collected on. */
export function staffMayCancelNow(job: { started: boolean; moneyCollected: boolean }): boolean {
    return !job.started && !job.moneyCollected;
}

/** Staff restore only a cancellation that recorded the status it left, and never a completed one. */
export function staffMayRestoreFrom(before: RestorableStatus | null): boolean {
    return before !== null && before !== INSPECTION_STATUS.COMPLETED;
}

/** Staff confirm a booking, never reopen a completed visit. */
export function staffMayConfirmFrom(status: string): boolean {
    return status !== INSPECTION_STATUS.COMPLETED;
}
