/**
 * The scheduled QuickBooks sweep.
 *
 * Lives in the QBO domain rather than in `scheduled.ts` because it is QuickBooks
 * behaviour that happens to be triggered by a cron, not cron behaviour: it owns
 * the per-tenant credential question, the service construction, and what a skip
 * means. `scheduled.ts` is the entry point and should read as a list of what
 * runs, not as the bodies of each one.
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { qboConnections } from '../../lib/db/schema/qbo';
import { logger } from '../../lib/logger';
import { InvoiceService } from '../invoice.service';
import { QBOService } from '../qbo.service';
import { resolveQboCredentialsForTenant } from './resolve-credentials';

/** Only what this sweep reads. `scheduled.ts`'s `ScheduledEnv` satisfies it. */
export interface QboCronEnv {
    DB: D1Database;
    TENANT_CACHE?: KVNamespace;
    JWT_SECRET?: string;
    JWT_SECRET_PREVIOUS?: string;
    QBO_CLIENT_ID?: string;
    QBO_CLIENT_SECRET?: string;
    QBO_WEBHOOK_SECRET?: string;
    QBO_ENV?: string;
}

/**
 * The inbound QuickBooks sweep, one tenant at a time.
 *
 * EXPORTED so it can be tested. It was module-private, which is the mechanical
 * reason it had no coverage at all — and the defect below lived in that gap for
 * the whole life of the feature.
 *
 * It used to resolve credentials ONCE from `env`, before the loop. Cron has no
 * Hono middleware, so `integrationSecretsMiddleware` never runs and a tenant's
 * encrypted secrets are invisible here. On a `qboAppManaged: false` deployment
 * the settings form is the ONLY place an operator can put a credential, so the
 * sweep read nothing, logged `QBO not configured`, and returned — for an
 * operator who had configured it. A connection that worked in the browser and
 * a settings page reading "Active", with inbound reconciliation that had never
 * run once.
 *
 * Credentials are a per-tenant question and are now asked per tenant, inside
 * the loop that was already per-tenant.
 */
export async function runQBOCDC(env: QboCronEnv): Promise<void> {
    // The one genuinely deployment-wide precondition: `JWT_SECRET` is the KDF
    // input for the secrets envelope, so without it NO tenant's credentials can
    // be decrypted. `QBO_CLIENT_ID` is deliberately not checked here — from
    // this point on it is a per-tenant question, and checking it up front is
    // precisely what made self-hosted deploys unreachable.
    if (!env.JWT_SECRET) {
        logger.info('[cron:qbo] JWT_SECRET unset — tenant secrets cannot be decrypted, skipping CDC');
        return;
    }
    const invoiceSvc = new InvoiceService(env.DB);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = drizzle(env.DB as any);
    const connections = await db.select().from(qboConnections).where(eq(qboConnections.syncEnabled, true)).all();

    for (const conn of connections) {
        const { credentials, missing } = await resolveQboCredentialsForTenant(env, conn.tenantId);
        if (!credentials) {
            // Name the tenant and the keys. "QBO not configured" was the old
            // wording and it was false for exactly the operator it hurt: they
            // had configured it, on the settings form, where cron could not
            // see it. A skip reason that names the wrong cause hides a whole
            // feature having never run.
            logger.warn('[cron:qbo] sync-enabled connection with unresolvable credentials — skipping tenant', {
                tenantId: conn.tenantId, missing,
            });
            continue;
        }
        const svc = new QBOService(
            env.DB,
            credentials.clientId,
            credentials.clientSecret,
            credentials.webhookSecret,
            env.JWT_SECRET,
            credentials.qboEnv,
        );
        try {
            const { processed } = await svc.runCDCSync(
                conn.tenantId,
                // Inbound: the row appended is dropped on purpose — QuickBooks
                // is where this figure came from, so it must not be pushed back.
                async (invoiceId, tid) => { await invoiceSvc.markPaid(invoiceId, tid, 'qbo'); },
                async (invoiceId, amountPaidCents, tid) => { await invoiceSvc.markPartial(invoiceId, tid, 'qbo', amountPaidCents); },
            );
            if (processed > 0) logger.info('[cron:qbo] CDC processed invoices', { tenantId: conn.tenantId, processed });
        } catch (e) {
            logger.error('[cron:qbo] tenant CDC failed', { tenantId: conn.tenantId }, e instanceof Error ? e : undefined);
        }
    }
}
