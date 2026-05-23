import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { AutomationService } from './services/automation.service';
import { AgreementService } from './services/agreement.service';
import { QBOService } from './services/qbo.service';
import { InvoiceService } from './services/invoice.service';
import { flushOutboxOnce } from './services/outbox.service';
import { qboConnections } from './lib/db/schema/qbo';
import { logger } from './lib/logger';

export interface ScheduledEnv {
    DB: D1Database;
    PHOTOS?: R2Bucket;
    RESEND_API_KEY?: string;
    SENDER_EMAIL?: string;
    APP_NAME?: string;
    APP_BASE_URL?: string;
    JWT_SECRET?: string;
    QBO_CLIENT_ID?: string;
    QBO_CLIENT_SECRET?: string;
    QBO_WEBHOOK_SECRET?: string;
    // Multi-workspace sync: portal base URL + M2M secret(s) for the
    // outbox flush worker. Optional — flush is a no-op when missing.
    PORTAL_API_URL?: string;
    PORTAL_M2M_SECRET?: string;
    PORTAL_M2M_CURRENT_KID?: string;
    PORTAL_M2M_SECRET_V1?: string;
    PORTAL_M2M_SECRET_V2?: string;
    PORTAL_M2M_SECRET_V3?: string;
}

/**
 * Pick the outbound M2M secret for portal → core or core → portal calls.
 * Prefers the keyring slot named by PORTAL_M2M_CURRENT_KID, falls back
 * to the legacy single-secret env, returns null when nothing is set.
 */
function resolveOutboundM2mSecret(env: ScheduledEnv): string | null {
    const kid = env.PORTAL_M2M_CURRENT_KID;
    if (kid) {
        const slot = (env as unknown as Record<string, string | undefined>)[`PORTAL_M2M_SECRET_${kid.toUpperCase()}`];
        if (slot) return slot;
    }
    return env.PORTAL_M2M_SECRET ?? null;
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
    event: ScheduledEvent,
    env: ScheduledEnv,
    _ctx: ExecutionContext,
): Promise<void> {
    // Daily at 02:00 UTC — expire stale agreement_requests (Spec 2A)
    if (event.cron === '0 2 * * *') {
        const agreementService = new AgreementService(env.DB);
        const count = await agreementService.expireOlderThan(14);
        logger.info('[cron] expired agreements', { count });
        return;
    }

    // Hourly at :00 — QBO CDC payment status sync
    if (event.cron === '0 * * * *') {
        await runQBOCDC(env);
        return;
    }

    // Every-minute — automation flush
    if (!env.RESEND_API_KEY) {
        logger.info('scheduled: RESEND_API_KEY not set, skipping');
    } else {
        const svc = new AutomationService(env.DB);
        await svc.flush(
            env.RESEND_API_KEY,
            env.SENDER_EMAIL || '',
            env.APP_NAME || 'OpenInspection',
            env.APP_BASE_URL || '',
        );
    }

    // Every-minute — drain the user-sync outbox to portal so identities
    // + memberships stay coherent across the two apps. No-op when the
    // portal base URL / M2M secret is missing (e.g. standalone deploys).
    if (env.PORTAL_API_URL) {
        const m2mSecret = resolveOutboundM2mSecret(env);
        if (m2mSecret) {
            try {
                await flushOutboxOnce(env.DB, env.PORTAL_API_URL, m2mSecret, 50);
            } catch (err) {
                // flushOutboxOnce handles per-row errors internally; only
                // catch the catastrophic "couldn't even start" case here.
                logger.error('[cron:outbox] flush threw', {}, err instanceof Error ? err : undefined);
            }
        } else {
            logger.info('[cron:outbox] flush skipped (no M2M secret)');
        }
    }

    // Phase T (T26): clean up abandoned _pending message attachments older than 24h.
    try {
        if (env.PHOTOS) await cleanupPendingAttachments(env.PHOTOS);
    } catch (e) {
        logger.error('[cron] _pending cleanup failed', {}, e instanceof Error ? e : undefined);
    }
}
