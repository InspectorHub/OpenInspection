import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { AutomationService } from './services/automation.service';
import { maybeMetering } from './services/metering.service';
import { AgreementService } from './services/agreement.service';
import { buildTenantEmailService } from './lib/email/build-email-service';
import type { EmailServiceEnv } from './lib/email/build-email-service';
import { QBOService } from './services/qbo.service';
import { InvoiceService } from './services/invoice.service';
import { qboConnections } from './lib/db/schema/qbo';
import { logger } from './lib/logger';
import type { SyncEnvelope } from './lib/sync-events/envelope';

export interface ScheduledEnv {
    DB: D1Database;
    APP_MODE?: string;
    PHOTOS?: R2Bucket;
    RESEND_API_KEY?: string;
    SENDER_EMAIL?: string;
    APP_NAME?: string;
    APP_BASE_URL?: string;
    JWT_SECRET?: string;
    JWT_SECRET_PREVIOUS?: string;
    QBO_CLIENT_ID?: string;
    QBO_CLIENT_SECRET?: string;
    QBO_WEBHOOK_SECRET?: string;
    // Track L — platform-default Twilio creds + the KV used by loadTwilioForTenant
    // to read per-tenant secrets. The cron SMS runtime is built only when both
    // TENANT_CACHE and JWT_SECRET are present (else SMS logs self-skip 'not configured').
    TWILIO_ACCOUNT_SID?: string;
    TWILIO_AUTH_TOKEN?: string;
    TWILIO_FROM_NUMBER?: string;
    TENANT_CACHE?: KVNamespace;
    // Core -> portal user-sync transport (A-13/A-14). Producer binding to the
    // sync queue; the outbox sweeper republishes pending rows through it.
    // Optional — sweeper is a no-op when missing (standalone).
    SYNC_QUEUE?: Queue<SyncEnvelope>;
}

async function runQBOCDC(env: ScheduledEnv): Promise<void> {
    if (!env.JWT_SECRET || !env.QBO_CLIENT_ID) {
        logger.info('[cron:qbo] QBO not configured — skipping CDC');
        return;
    }
    const svc = new QBOService(
        env.DB,
        env.QBO_CLIENT_ID,
        env.QBO_CLIENT_SECRET ?? '',
        env.QBO_WEBHOOK_SECRET ?? '',
        env.JWT_SECRET,
    );
    const invoiceSvc = new InvoiceService(env.DB);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = drizzle(env.DB as any);
    const connections = await db.select().from(qboConnections).where(eq(qboConnections.syncEnabled, 1)).all();

    for (const conn of connections) {
        try {
            const { processed } = await svc.runCDCSync(
                conn.tenantId,
                (invoiceId, tid) => invoiceSvc.markPaid(invoiceId, tid, 'qbo'),
                (invoiceId, _bal, tid) => invoiceSvc.markPartial(invoiceId, tid, 'qbo'),
            );
            if (processed > 0) logger.info('[cron:qbo] CDC processed invoices', { tenantId: conn.tenantId, processed });
        } catch (e) {
            logger.error('[cron:qbo] tenant CDC failed', { tenantId: conn.tenantId }, e instanceof Error ? e : undefined);
        }
    }
}

async function cleanupPendingAttachments(photos: R2Bucket): Promise<void> {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let cursor: string | undefined = undefined;
    let deleted = 0;
    do {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list: R2Objects = await (photos as any).list({ cursor, limit: 1000 });
        for (const obj of list.objects) {
            if (obj.key.includes('/messages/_pending/') && obj.uploaded.getTime() < cutoff) {
                await photos.delete(obj.key);
                deleted++;
            }
        }
        cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
    if (deleted > 0) logger.info('[cron] cleaned up _pending message attachments', { deleted });
}

export async function scheduled(
    _event: ScheduledEvent,
    env: ScheduledEnv,
    _ctx: ExecutionContext,
): Promise<void> {
    // Single unified cron (recommended: `*/5 * * * *`) — runs all
    // periodic tasks each tick. All jobs are idempotent and the
    // increased frequency for the daily/hourly ones is harmless:
    //   - agreementService.expireOlderThan is a WHERE-filtered UPDATE
    //     that no-ops once the rows are already expired.
    //   - runQBOCDC processes only connections with new CDC entries
    //     since last sync; cost is proportional to actual change.
    // If you have spare CF cron triggers, you can split this back out
    // (see git history for the per-cron-expression branching version).

    // 1. Agreement expiry (Spec 2A — was daily 02:00 UTC)
    try {
        const agreementService = new AgreementService(
            env.DB,
            env.JWT_SECRET ? { jwtSecret: env.JWT_SECRET, ...(env.JWT_SECRET_PREVIOUS ? { jwtSecretPrevious: env.JWT_SECRET_PREVIOUS } : {}) } : undefined,
        );
        const count = await agreementService.expireOlderThan(14);
        if (count > 0) logger.info('[cron] expired agreements', { count });
    } catch (e) {
        logger.error('[cron] agreement expiry failed', {}, e instanceof Error ? e : undefined);
    }

    // 2. QBO CDC payment sync (was hourly)
    try {
        await runQBOCDC(env);
    } catch (e) {
        logger.error('[cron] QBO CDC failed', {}, e instanceof Error ? e : undefined);
    }

    // 3a. Track J — enqueue inspection.reminder logs (no email key needed to enqueue;
    //     the flush below sends due ones). Idempotent per (rule, inspection).
    try {
        const svc = new AutomationService(env.DB, undefined, undefined, maybeMetering(env));
        const n = await svc.enqueueReminders(Date.now());
        if (n > 0) logger.info('[cron] enqueued inspection reminders', { count: n });
    } catch (e) {
        logger.error('[cron] reminder enqueue failed', {}, e instanceof Error ? e : undefined);
    }

    // 3. Automation queue flush (email + SMS). Always runs: email logs self-skip
    //    when RESEND_API_KEY is empty; SMS logs resolve their own per-tenant Twilio
    //    creds (platform env or tenant own) via the runtime built from env below.
    try {
        const svc = new AutomationService(env.DB, undefined, undefined, maybeMetering(env));
        const sms = (env.TENANT_CACHE && env.JWT_SECRET)
            ? {
                resolveCreds: (tenantId: string) =>
                    import('./lib/sms/resolve-twilio').then(({ loadTwilioForTenant }) =>
                        loadTwilioForTenant({
                            DB: env.DB, TENANT_CACHE: env.TENANT_CACHE!, JWT_SECRET: env.JWT_SECRET!,
                            ...(env.JWT_SECRET_PREVIOUS ? { JWT_SECRET_PREVIOUS: env.JWT_SECRET_PREVIOUS } : {}),
                            ...(env.TWILIO_ACCOUNT_SID ? { TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID } : {}),
                            ...(env.TWILIO_AUTH_TOKEN ? { TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN } : {}),
                            ...(env.TWILIO_FROM_NUMBER ? { TWILIO_FROM_NUMBER: env.TWILIO_FROM_NUMBER } : {}),
                        }, tenantId)),
              }
            : null;
        await svc.flush(
            (tid) => buildTenantEmailService(env as EmailServiceEnv, tid),
            env.APP_NAME || 'OpenInspection',
            env.APP_BASE_URL || '',
            sms,
        );
    } catch (e) {
        logger.error('[cron] automation flush failed', {}, e instanceof Error ? e : undefined);
    }

    // 4. Sweep the user-sync outbox onto the sync queue (no-op for standalone —
    //    gated on SYNC_QUEUE, the producer binding present only in saas).
    if (env.SYNC_QUEUE) {
        try {
            const { drainPortalOutbox } = await import('./portal/integration.module');
            await drainPortalOutbox(env);
        } catch (err) {
            logger.error('[cron:outbox] sweeper threw', {}, err instanceof Error ? err : undefined);
        }
    }

    // 5. Clean up abandoned _pending message attachments older than 24h
    try {
        if (env.PHOTOS) await cleanupPendingAttachments(env.PHOTOS);
    } catch (e) {
        logger.error('[cron] _pending cleanup failed', {}, e instanceof Error ? e : undefined);
    }

    // 6. Track I-a GDPR retention sweep (spec §7) — final destruction of
    //    past-window signed-agreement signatures (signature_base64 -> NULL +
    //    purged_at marker). Keeps the esign_audit_logs chain. Idempotent,
    //    tenant-batched (single grouped query joined to tenant_configs).
    try {
        const { runRetentionSweep } = await import('./lib/compliance/retention-sweep');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const summary = await runRetentionSweep(drizzle(env.DB) as any, Date.now());
        if (summary.purgedEnvelopes > 0) {
            logger.info('[cron] retention sweep purged signatures', summary);
        }
    } catch (e) {
        logger.error('[cron] retention sweep failed', {}, e instanceof Error ? e : undefined);
    }

    // 7. Daily R2 usage measurement (03:00–03:05 UTC window fires once/day on the
    //    */5 cron). Writes r2_bytes gauge per tenant via MeteringService. Runs in
    //    every mode — standalone simply has one tenant in the table, so it records a
    //    single whole-instance measurement, populating the /settings/usage Storage
    //    figure everywhere.
    {
        const now = new Date();
        if (now.getUTCHours() === 3 && now.getUTCMinutes() < 5) {
            try {
                const { drizzle: drizzleR2 } = await import('drizzle-orm/d1');
                const { tenants } = await import('./lib/db/schema/tenant');
                const { MeteringService } = await import('./services/metering.service');
                const { R2UsageService } = await import('./services/r2-usage.service');
                const ids = (await drizzleR2(env.DB).select({ id: tenants.id }).from(tenants).all()).map(r => r.id);
                await new R2UsageService(env.PHOTOS!, new MeteringService(env.DB)).measureAll(ids);
                logger.info('[usage] R2 measurement complete', { tenants: ids.length });
            } catch (err) {
                logger.error('[usage] R2 measurement failed', {}, err instanceof Error ? err : undefined);
            }
        }
    }
}
