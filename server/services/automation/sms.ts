import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { automationLogs, automations, inspections, tenants, tenantConfigs } from '../../lib/db/schema';
import { logger } from '../../lib/logger';
import { currentPeriodKey } from '../../lib/usage/period';
import { interpolate, type Constructor } from './shared';
import { buildBaseTemplateVars } from './template-vars';
import type { AutomationBase } from './shared';

/**
 * SMS delivery mixin — REGULATORY (TCPA consent). This is the SMS-consent flow:
 * client logs are gated on a recorded 'granted' consent event before any text is
 * sent (agents/inspector are implied; D5). The consent gate, opt-in ledger lookup,
 * and the fail-closed review_url guard are kept INTACT and byte-identical — do not
 * alter the consent logic. Renders the rule's plain-text smsBody, maps Twilio
 * ok→sent / !ok→failed, and meters a successful send. Never throws.
 */
export function AutomationSms<TBase extends Constructor<AutomationBase>>(Base: TBase) {
    return class extends Base {
        /**
         * Track L — deliver one SMS automation log via Twilio. Client logs are gated
         * on a recorded 'granted' consent event (agents/inspector are implied; D5);
         * creds resolve through the injected sms.resolveCreds (per-tenant platform/own).
         * Renders the rule's plain-text smsBody with the var map, fail-closed on an
         * unconfigured review_url. Maps Twilio ok→sent / !ok→failed; every guard skips
         * the log with a reason. Never throws (caller's try/catch marks failed otherwise).
         */
        // Public (was `private` on the monolith) so the delivery mixin's flush() can
        // call it through a typed cross-mixin contract; no runtime behavior change.
        // The tests already reach it via `(svc as any).deliverSms(...)`.
        async deliverSms(
            db: DrizzleD1Database,
            ctx: { log: typeof automationLogs.$inferSelect; automation: typeof automations.$inferSelect;
                   inspection: typeof inspections.$inferSelect; tenant: typeof tenants.$inferSelect },
            sms: { resolveCreds: (tenantId: string) => Promise<import('../../lib/sms/resolve-twilio').TwilioCreds | null> } | null | undefined,
            appName: string, appHost: string,
        ): Promise<void> {
            const { log, automation, inspection, tenant } = ctx;
            const skip = (reason: string) =>
                db.update(automationLogs).set({ status: 'skipped', error: reason }).where(eq(automationLogs.id, log.id));

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

            const creds = await sms.resolveCreds(inspection.tenantId);
            if (!creds) return void (await skip('sms not configured'));

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

            const { sendTwilioSms } = await import('../../lib/sms/send-sms');
            const res = await sendTwilioSms(creds, log.recipient, body);
            if (res.ok) {
                await db.update(automationLogs).set({ status: 'sent', deliveredAt: new Date().toISOString() })
                    .where(eq(automationLogs.id, log.id));
                try {
                    await this.metering?.record(tenant.id, 'sms', currentPeriodKey(new Date()));
                } catch { /* metering must never break delivery */ }
            } else {
                await db.update(automationLogs).set({ status: 'failed', error: res.error })
                    .where(eq(automationLogs.id, log.id));
                logger.error('AutomationService.flush: twilio send failed', { logId: log.id });
            }
        }
    };
}
