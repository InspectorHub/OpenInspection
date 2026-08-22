/**
 * Cron jobs that reconcile state with something outside this Worker: an
 * accounting system, the portal, a messaging carrier, a calendar.
 *
 * All four share one property worth naming - their cost is dominated by network
 * I/O, which does NOT count against the Workers CPU budget. What counts is the
 * per-row work around it, which is what their batch caps bound.
 */
import { and, eq, inArray, isNull, lt, notInArray, or } from 'drizzle-orm';
import { qboConnections } from '../../lib/db/schema/qbo';
import { syncOutbox } from '../../lib/db/schema/tenant/integration';
import { messagingCompliance } from '../../lib/db/schema/compliance';
import { calendarConnections } from '../../lib/db/schema/calendar';
import { SYNC_OUTBOX_STATUS } from '../../lib/status/sync-outbox-status';
import { runQBOCDC } from '../../services/qbo/cron-cdc';
import { logger } from '../../lib/logger';
import { TICK, db, exists, type CronJob } from '../types';

// 2. QBO CDC payment sync (was hourly)
export const qboCdcJob: CronJob = {
    key: 'qbo-cdc',
    label: 'QuickBooks change-data-capture payment sync',
    trigger: TICK,
    modes: ['standalone', 'saas'],
    maxBatch: 50,
    // JWT_SECRET is the sweep's own deployment-wide precondition (it is the
    // KDF input for the secrets envelope, so without it NO tenant's
    // credentials decrypt) and a sync-enabled connection is its own row
    // predicate. Both are taken from runQBOCDC rather than restated.
    probe: async (env) => {
        if (!env.JWT_SECRET) return 0;
        return exists(
            db(env).select({ tenantId: qboConnections.tenantId })
                .from(qboConnections)
                .where(eq(qboConnections.syncEnabled, true))
                .limit(1).get(),
        );
    },
    run: async (env) => {
        await runQBOCDC(env);
        return { processed: 1, nextCursor: null };
    },
};

// 4. Sweep the user-sync outbox onto the sync queue (no-op for standalone —
//    gated on SYNC_QUEUE, the producer binding present only in saas).
export const portalOutboxJob: CronJob = {
    key: 'portal-outbox',
    label: 'Republish pending user-sync outbox rows',
    trigger: TICK,
    // The only job whose absence is TOPOLOGY, not configuration: standalone
    // has no portal to sync to, so there is nothing for a probe to find.
    modes: ['saas'],
    // flushOutboxOnce() fixes its own limit at 50 and takes no argument from
    // here, so this restates that number rather than setting it. If the two
    // ever disagree, the callee wins and this line is the lie.
    maxBatch: 50,
    probe: async (env) => {
        if (!env.SYNC_QUEUE) return 0;
        return exists(
            db(env).select({ id: syncOutbox.id })
                .from(syncOutbox)
                .where(eq(syncOutbox.status, SYNC_OUTBOX_STATUS.PENDING))
                .limit(1).get(),
        );
    },
    run: async (env) => {
        const { drainPortalOutbox } = await import('../../portal/integration.module');
        await drainPortalOutbox(env);
        return { processed: 1, nextCursor: null };
    },
};

// 5c. Managed compliance status poll (Task 7 / Plan 2) — re-read brand/campaign/
//     TFV status from the carrier for non-terminal managed rows. The sweep builds
//     the provider PER ROW by messaging_compliance.provider, so a mixed Twilio +
//     Telnyx fleet is reconciled in one pass. Runs when EITHER the Twilio ISV
//     triple OR TELNYX_API_KEY is present (so a Telnyx-only deploy still sweeps);
//     a row whose carrier has no configured creds is skipped fail-soft. Skipped
//     entirely when none are present (standalone / unconfigured saas).
export const managedComplianceJob: CronJob = {
    key: 'managed-compliance',
    label: 'Poll carrier compliance status for managed messaging rows',
    trigger: TICK,
    // Configuration, not topology: a standalone deployment CAN hold managed
    // carrier credentials, and the probe below is what decides.
    modes: ['standalone', 'saas'],
    maxBatch: 50,
    probe: async (env) => {
        const twilioIsvConfigured = !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET);
        if (!twilioIsvConfigured && !env.TELNYX_API_KEY) return 0;
        return exists(
            db(env).select({ tenantId: messagingCompliance.tenantId })
                .from(messagingCompliance)
                .where(and(
                    inArray(messagingCompliance.mode, ['managed_shared', 'managed_dedicated']),
                    notInArray(messagingCompliance.complianceStatus, ['approved', 'rejected']),
                ))
                .limit(1).get(),
        );
    },
    run: async (env) => {
        const { MessagingComplianceService } = await import('../../services/messaging-compliance.service');
        const svc = new MessagingComplianceService(env.DB);
        // Pass an outbox when the sync queue is bound (SaaS) so status transitions
        // are propagated to portal. Absent in standalone — no-op (outbox = undefined).
        // Dynamic import keeps portal code out of the standalone bundle by construction.
        const outbox = env.SYNC_QUEUE
            ? await import('../../portal/integration.module').then(({ buildUserSyncOutbox }) => buildUserSyncOutbox(env))
            : undefined;
        const resolverEnv = {
            TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
            TWILIO_API_KEY_SID: env.TWILIO_API_KEY_SID,
            TWILIO_API_KEY_SECRET: env.TWILIO_API_KEY_SECRET,
            TELNYX_API_KEY: env.TELNYX_API_KEY,
        };
        await svc.sweepManagedStatuses(resolverEnv, outbox);
        return { processed: 1, nextCursor: null };
    },
};

// 5d. Pull each connected inspector's Google busy time on a schedule, so
//     "Sync now" stops being something anyone has to remember. Body lives
//     in lib/calendar/sync-sweep; it never throws and records its own
//     per-connection failures as last_sync_error.
export const calendarSyncJob: CronJob = {
    key: 'calendar-sync',
    label: 'Pull connected calendars for busy time',
    trigger: TICK,
    modes: ['standalone', 'saas'],
    // sweepCalendarSyncs applies its own MAX_CONNECTIONS_PER_TICK (25) and
    // takes no cap from here, so this restates that number rather than setting
    // it. It is NOT a second, competing limit — a lower value here would
    // promise a bound nothing enforces.
    maxBatch: 25,
    probe: async (env) => {
        if (!env.TENANT_CACHE || !env.JWT_SECRET) return 0;
        const { SYNC_INTERVAL_MS } = await import('../../lib/calendar/sync-sweep');
        const dueBefore = new Date(Date.now() - SYNC_INTERVAL_MS);
        return exists(
            db(env).select({ id: calendarConnections.id })
                .from(calendarConnections)
                .where(or(
                    isNull(calendarConnections.lastSyncAt),
                    lt(calendarConnections.lastSyncAt, dueBefore),
                ))
                .limit(1).get(),
        );
    },
    run: async (env) => {
        // This block carried NO try/catch in the monolithic handler. Its
        // comment argued the sweep never throws, which is true of the sweep
        // and not of the dynamic import above it — and an import failure
        // here took every LATER job down with it. Every job now sits behind
        // one uniform catch in the consumer, which closes that hole.
        const { sweepCalendarSyncs } = await import('../../lib/calendar/sync-sweep');
        const swept = await sweepCalendarSyncs({
            DB: env.DB, TENANT_CACHE: env.TENANT_CACHE!, JWT_SECRET: env.JWT_SECRET!,
            ...(env.JWT_SECRET_PREVIOUS ? { JWT_SECRET_PREVIOUS: env.JWT_SECRET_PREVIOUS } : {}),
            ...(env.GOOGLE_CLIENT_ID ? { GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID } : {}),
            ...(env.GOOGLE_CLIENT_SECRET ? { GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET } : {}),
        });
        if (swept.attempted > 0) logger.info('[cron] calendar sync sweep', swept);
        return { processed: swept.attempted, nextCursor: null };
    },
};
