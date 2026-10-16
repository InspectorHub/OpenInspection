/**
 * What the hub page needs to know to stop offering a cancel or a restore the API would
 * refuse office staff, decided here by the same facts the routes use so the page does not
 * guess: whether any money has been collected (the cancellation quote's own figure, which
 * counts held deposits and ledger payments, not only the order's payment flag), and the
 * status a cancelled job had before it was cancelled.
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { INSPECTION_STATUS } from '../status/inspection-status';
import { quoteCancellation } from '../../services/inspection/cancellation.service';
import { recordedStatusBeforeCancel, type RestorableStatus } from './cancel-restore';

export interface HubLifecycle {
    /** Money has been collected on this inspection: a payment on its invoice, or a held deposit. */
    moneyCollected: boolean;
    /** For a cancelled inspection, the status it had; null when not cancelled or when the cancellation recorded none. */
    statusBeforeCancel: RestorableStatus | null;
}

export async function hubLifecycle(
    db: DrizzleD1Database,
    tenantId: string,
    inspection: { id: string; status: string; paymentStatus: string },
): Promise<HubLifecycle> {
    // The reason only shapes the fee; the amount collected does not depend on it.
    const quote = await quoteCancellation(db, tenantId, inspection.id, 'client_cancelled');
    return {
        moneyCollected: quote.paidCents > 0 || inspection.paymentStatus !== 'unpaid',
        statusBeforeCancel: inspection.status === INSPECTION_STATUS.CANCELLED
            ? await recordedStatusBeforeCancel(db, tenantId, inspection.id)
            : null,
    };
}
