/**
 * Cron jobs over agreement envelopes: the expiry clock and the retention clock.
 *
 * Two different definitions of "due" - one counts from `sent_at`, the other
 * from `signed_at` against a per-tenant window - which is why they are two jobs
 * rather than one. A single block cannot hold two definitions of due.
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import { agreementRequests } from '../../lib/db/schema/inspection/agreements';
import { AgreementService } from '../../services/agreement.service';
import { logger } from '../../lib/logger';
import { TICK, db, exists, type CronJob } from '../types';

// 1. Agreement expiry (Spec 2A — was daily 02:00 UTC)
export const agreementExpiryJob: CronJob = {
    key: 'agreement-expiry',
    label: 'Expire agreement envelopes older than 14 days',
    trigger: TICK,
    modes: ['standalone', 'saas'],
    // One WHERE-filtered UPDATE pair. There is nothing to batch: the unit of
    // work is the statement, not the row.
    maxBatch: 1,
    // The same predicate expireOlderThan() already UPDATEs on, as a LIMIT 1
    // existence check. Reusing it is the point: a probe with its own idea of
    // "due" drifts away from the job and starts enqueueing empty work.
    probe: (env) => exists(
        db(env).select({ id: agreementRequests.id })
            .from(agreementRequests)
            .where(and(
                inArray(agreementRequests.status, ['pending', 'sent', 'viewed']),
                lt(agreementRequests.sentAt, new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)),
            ))
            .limit(1).get(),
    ),
    run: async (env) => {
        const agreementService = new AgreementService(
            env.DB,
            env.JWT_SECRET
                ? { jwtSecret: env.JWT_SECRET, ...(env.JWT_SECRET_PREVIOUS ? { jwtSecretPrevious: env.JWT_SECRET_PREVIOUS } : {}) }
                : undefined,
        );
        await agreementService.expireOlderThan(14);
        return { processed: 1, nextCursor: null };
    },
};

// 6. Track I-a GDPR retention sweep (spec §7) — final destruction of
//    past-window signed-agreement signatures (signature_base64 -> NULL +
//    purged_at marker). Keeps the esign_audit_logs chain. Idempotent,
//    tenant-batched (single grouped query joined to tenant_configs).
export const retentionAgreementsJob: CronJob = {
    key: 'retention-agreements',
    label: 'Destroy past-window signed-agreement signatures',
    trigger: TICK,
    modes: ['standalone', 'saas'],
    maxBatch: 50,
    // runRetentionSweep()'s own candidate predicate, as a LIMIT 1. The
    // per-tenant window is applied in JS from a joined config value, so this
    // is a superset — it can enqueue a pass that purges nothing, and cannot
    // withhold one that would.
    probe: (env) => exists(
        db(env).select({ id: agreementRequests.id })
            .from(agreementRequests)
            .where(and(
                eq(agreementRequests.status, 'signed'),
                isNull(agreementRequests.purgedAt),
            ))
            .limit(1).get(),
    ),
    run: async (env) => {
        const { runRetentionSweep } = await import('../../lib/compliance/retention-sweep');
        // PHOTOS was already in scope here and simply never passed. The sweep
        // now destroys signed.pdf, certificate.pdf and evidence.zip in the same
        // pass that nulls the signature column — review review: nulling the
        // column while the PDF still embeds the same image is database
        // retention wearing the name of retention.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const agreementSweepDb = drizzle(env.DB) as any;
        const summary = await runRetentionSweep(agreementSweepDb, Date.now(), { photos: env.PHOTOS });
        if (summary.purgedEnvelopes > 0) {
            logger.info('[cron] retention sweep purged signatures', summary);
        }
        return { processed: summary.purgedEnvelopes, nextCursor: null };
    },
};
