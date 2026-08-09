/**
 * One door to `status = 'cancelled'` (#78).
 *
 * Cancelling an inspection is not a status write. `POST /api/inspections/:id/cancel`
 * prices the cancellation against the tenant's ladder, refuses to charge a fee
 * the caller has not acknowledged, appends the refund to the payment ledger,
 * records WHY in `cancel_reason`, and fires `inspection.cancelled`. A plain
 * status write does none of that — it produces a job that is cancelled in the
 * list view while the invoice still reads as owed and the deposit stays held,
 * with nothing anywhere saying the two disagree.
 *
 * So the other writers refuse. This is the refusal, shared rather than copied,
 * because the failure mode is silent on BOTH doors and a second copy is how one
 * of them drifts back open. The cancel route's own comment already names the
 * surfaces it was worried about — "a bulk action, an MCP tool, a mobile client"
 * — and two of the three were real:
 *
 *   PATCH /api/inspections/:id    { status: 'cancelled' }               → ./patch-guards
 *   PATCH /api/inspections/bulk   { action: 'updateStatus', status: … } → ./bulk
 *
 * Both answer 400 with the code below. 400 rather than a status of its own
 * because it is the code both routes already use for a body they will not
 * apply, and the machine-readable part callers branch on is the `code`.
 *
 * NOT a guard against leaving `cancelled`. Un-cancelling is a plain status write
 * and stays one: a mis-click in the confirmation dialog has to be recoverable,
 * and the PATCH handler clears the cancellation record on the way out.
 */
import { INSPECTION_STATUS } from '../../lib/status/inspection-status';

export interface CancelWritePathRefusal {
    code: 'USE_CANCEL_ENDPOINT';
    message: string;
}

/**
 * Returns the refusal when `status` would cancel an inspection, else null.
 *
 * Takes the raw value rather than a body so both callers — the single PATCH and
 * the bulk one, whose payloads have nothing else in common — ask the same
 * question.
 */
export function refuseCancelViaStatusWrite(status: string | null | undefined): CancelWritePathRefusal | null {
    if (status !== INSPECTION_STATUS.CANCELLED) return null;
    return {
        code: 'USE_CANCEL_ENDPOINT',
        message:
            'Cancelling applies the tenant cancellation policy — the fee, the refund and the recorded reason '
            + 'are computed there. Use POST /api/inspections/{id}/cancel instead of writing this status.',
    };
}
