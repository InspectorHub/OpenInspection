import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { AutomationService } from './services/automation.service';
import { AgreementService } from './services/agreement.service';
import { QBOService } from './services/qbo.service';
import { InvoiceService } from './services/invoice.service';
import { flushOutboxOnce } from './portal/outbox.service';
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
    // Multi-workspace sync: Service Binding to portal for the outbox
    // flush worker. Optional — flush is a no-op when missing.
    PORTAL_SERVICE?: Fetcher;
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
        const agreementService = new AgreementService(env.DB);
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

    // 3. Automation email queue flush
    if (!env.RESEND_API_KEY) {
        logger.info('scheduled: RESEND_API_KEY not set, skipping automation flush');
    } else {
        try {
            const svc = new AutomationService(env.DB);
            await svc.flush(
                env.RESEND_API_KEY,
                env.SENDER_EMAIL || '',
                env.APP_NAME || 'OpenInspection',
                env.APP_BASE_URL || '',
            );
        } catch (e) {
            logger.error('[cron] automation flush failed', {}, e instanceof Error ? e : undefined);
        }
    }

    // 4. Drain user-sync outbox to portal (no-op for standalone)
    if (env.PORTAL_SERVICE) {
        try {
            const { signM2mHeader } = await import('./lib/m2m-auth');
            const m2m = await signM2mHeader(env as unknown as Record<string, string | undefined>);
            await flushOutboxOnce(env.DB, env.PORTAL_SERVICE, m2m, 50);
        } catch (err) {
            logger.error('[cron:outbox] flush threw', {}, err instanceof Error ? err : undefined);
        }
    }

    // 5. Clean up abandoned _pending message attachments older than 24h
    try {
        if (env.PHOTOS) await cleanupPendingAttachments(env.PHOTOS);
    } catch (e) {
        logger.error('[cron] _pending cleanup failed', {}, e instanceof Error ? e : undefined);
    }
}
