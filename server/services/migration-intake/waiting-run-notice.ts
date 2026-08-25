import { logger } from '../../lib/logger';
import type { UserSyncOutbox } from '../../lib/integration/user-sync';
import { secondaryUseAuthorisedFor } from './staff-access';

/**
 * Tell the DEPLOYMENT OPERATOR that a file is waiting for a person.
 *
 * ⚠️ THERE IS AN AUDIT ACTION OF THE SAME NAME, written a few lines from the
 * one call site of this function, and they are DIFFERENT ARTEFACTS. The audit
 * row is the workspace's own trail: tenant-scoped, readable inside that
 * workspace, and read by nothing on the operator's side. This event is the only
 * thing that crosses. A reader who greps the name, finds the audit action first,
 * and concludes the operator has been told has found the wrong one of the two.
 *
 * Until this existed, nothing crossed at all. The run's other messages —
 * received, ready, declined, expiring — all go to the WORKSPACE's own owners and
 * managers by email. A file could therefore sit in a waiting run until its
 * retention clock ran out with nobody on the operator's side ever having learned
 * it arrived, and the deadline in the runbook was kept by somebody remembering.
 *
 * ── Fire-and-forget, deliberately ───────────────────────────────────────────
 * The run has already been created and the file already stored by the time this
 * is called; a queue that is briefly unreachable must not undo either. A failed
 * send leaves the outbox row `pending` for the cron sweeper. On a deployment
 * with no platform behind it there is no sink at all — and no waiting run
 * either, because the door that reaches this line is closed there.
 */
export function announceWaitingRun(
    outbox: UserSyncOutbox | undefined,
    run: {
        tenantId: string;
        batchId: string;
        /**
         * The workspace's OWN declaration of the product, or null.
         *
         * Never the stored row's `vendor`: a waiting run carries a placeholder
         * there so the column has a value, and publishing that placeholder would
         * put a guess on the wire. One of the two doors into a waiting run never
         * asks the question at all — it is the door for a file nobody could
         * classify — so null is the ordinary case rather than the edge.
         */
        vendor: string | null;
        uploadedAt: Date;
        expiresAt: Date;
    },
): void {
    void outbox?.append({
        type: 'migration.assistance_requested',
        payload: {
            tenantId: run.tenantId,
            batchId: run.batchId,
            vendor: run.vendor,
            // Epoch MILLISECONDS, matching the columns these come off. The
            // sibling tenant event on this seam carries SECONDS; converting
            // here would put a second unit in the pipeline for nothing.
            uploadedAt: run.uploadedAt.getTime(),
            expiresAt: run.expiresAt.getTime(),
            secondaryUseAuthorised: secondaryUseAuthorisedFor({ id: run.batchId }),
        },
    }).catch((err: unknown) => {
        logger.error('[migration-intake] nobody was told a file is waiting',
            { batchId: run.batchId },
            err instanceof Error ? err : new Error(String(err)));
    });
}
