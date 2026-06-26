import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { automationLogs, automations, inspections, tenants, tenantConfigs } from '../../lib/db/schema';
import { logger } from '../../lib/logger';
import { currentPeriodKey } from '../../lib/usage/period';
import { interpolate, type Constructor } from './shared';
import { buildBaseTemplateVars } from './template-vars';
import type { AutomationBase } from './shared';

/**
 * The SMS seam injected into deliverSms/flush: resolves a MessagingProvider and
 * the from-number for the given tenant. The shape mirrors loadProviderForTenant's
 * return — { provider, from } — so wiring is a one-liner in the cron entry.
 *
 * Twilio behavior is byte-identical: the provider is a TwilioClient and `from`
 * is the resolved number, so sendMessage({ from, to, body }) calls the same
 * TwilioClient.messages.create() path as the old sendTwilioSms helper.
 */
export type SmsRuntime = {
    resolveProvider: (tenantId: string) => Promise<{ provider: import('../../lib/messaging/provider').MessagingProvider; from: string | null } | null>;
} | null | undefined;

/**
 * SMS delivery mixin — REGULATORY (TCPA consent). This is the SMS-consent flow:
 * client logs are gated on a recorded 'granted' consent event before any text is
 * sent (agents/inspector are implied; D5). The consent gate, opt-in ledger lookup,
 * and the fail-closed review_url guard are kept INTACT and byte-identical — do not
 * alter the consent logic. Renders the rule's plain-text smsBody, calls
 * provider.sendMessage(), maps ok→sent / !ok→failed, and meters a successful send.
 * Never throws.
 */
export function AutomationSms<TBase extends Constructor<AutomationBase>>(Base: TBase) {
    return class extends Base {
        /**
         * Track L — deliver one SMS automation log via the resolved provider. Client
         * logs are gated on a recorded 'granted' consent event (agents/inspector are
         * implied; D5); the provider resolves through the injected sms.resolveProvider
         * (per-tenant Twilio or Telnyx). Renders the rule's plain-text smsBody with
         * the var map, fail-closed on an unconfigured review_url. Maps ok→sent /
         * !ok→failed; every guard skips the log with a reason. Never throws (caller's
         * try/catch marks failed otherwise).
         *
         * Twilio path is byte-for-byte identical: TwilioClient.messages.create({ from, to, body })
         * produces the same Twilio API call as the former sendTwilioSms helper.
         */
        // Public (was `private` on the monolith) so the delivery mixin's flush() can
        // call it through a typed cross-mixin contract; no runtime behavior change.
        // The tests already reach it via `(svc as any).deliverSms(...)`.
        async deliverSms(
            db: DrizzleD1Database,
            ctx: { log: typeof automationLogs.$inferSelect; automation: typeof automations.$inferSelect;
                   inspection: typeof inspections.$inferSelect; tenant: typeof tenants.$inferSelect },
            sms: SmsRuntime,
            appName: string, appHost: string,
        ): Promise<void> {
            const { log, automation, inspection, tenant } = ctx;
            const skip = (reason: string) =>
                db.update(automationLogs).set({ status: 'skipped', error: reason }).where(and(eq(automationLogs.id, log.id), eq(automationLogs.tenantId, inspection.tenantId)));

            if (!automation.smsBody?.trim()) return void (await skip('no sms body'));
            if (!sms) return void (await skip('sms not configured'));

            // Consent gate — client only (agents/inspector implied; D5).
            if (automation.recipient === 'client') {
                const { SmsConsentService } = await import('../sms-consent.service');
                const consentSvc = new SmsConsentService(this.db);
                const contactId = inspection.clientContactId;
                const latest = contactId ? await consentSvc.getLatest(inspection.tenantId, contactId) : null;
                if (latest !== 'granted') return void (await skip('no sms consent'));
            }

            const resolved = await sms.resolveProvider(inspection.tenantId);
            if (!resolved) return void (await skip('sms not configured'));
            const { provider, from } = resolved;

            // Load the tenant config row once for the SMS vars: company_phone is used
            // unconditionally by the seeded copy ("questions? call {{company_phone}}"),
            // and review_url is the fail-closed consumer below.
            const cfg = await db.select({ companyPhone: tenantConfigs.companyPhone, reviewUrl: tenantConfigs.reviewUrl })
                .from(tenantConfigs).where(eq(tenantConfigs.tenantId, inspection.tenantId)).get();

            const vars: Record<string, string> = {
                ...buildBaseTemplateVars(inspection, tenant, appName, appHost),
                company_phone:    cfg?.companyPhone ?? '',
            };
            // review_url fail-closed (same rule as the email path).
            if (automation.smsBody.includes('{{review_url}}')) {
                if (!cfg?.reviewUrl) return void (await skip('review_url not configured'));
                vars.review_url = cfg.reviewUrl;
            }
            const body = interpolate(automation.smsBody, vars);

            const sendArgs: { from?: string; to: string; body: string } = { to: log.recipient, body };
            if (from) sendArgs.from = from;
            const res = await provider.sendMessage(sendArgs);
            if (res.ok) {
                await db.update(automationLogs).set({ status: 'sent', deliveredAt: new Date().toISOString() })
                    .where(and(eq(automationLogs.id, log.id), eq(automationLogs.tenantId, inspection.tenantId)));
                try {
                    await this.metering?.record(tenant.id, 'sms', currentPeriodKey(new Date()));
                } catch { /* metering must never break delivery */ }
            } else {
                await db.update(automationLogs).set({ status: 'failed', error: res.error })
                    .where(and(eq(automationLogs.id, log.id), eq(automationLogs.tenantId, inspection.tenantId)));
                logger.error('AutomationService.flush: sms send failed', { logId: log.id });
            }
        }
    };
}
