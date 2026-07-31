/**
 * SMS delivery mixin — REGULATORY (TCPA consent). Thin wrapper: resolves the
 * automation's SMS template, then hands off to `sendOneSms` (A3.3 extracted
 * core) so the manual SMS endpoint and the automation flush share one gate.
 *
 * Do not re-implement consent / managed-send / quota / review_url here — that
 * is the whole point of the extraction. Template resolution stays HERE because
 * automations resolve from `automation.smsTemplateId` while manual sends
 * resolve from the role profile's `smsTemplateId`.
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { automations, tenants } from '../../lib/db/schema';
import { automationClassId } from '../../lib/notifications/automation-classes';
import { automationLogs } from '../../lib/db/schema';
import { eq, and } from 'drizzle-orm';
import type { Constructor, FlushInspection } from './shared';
import type { AutomationBase } from './shared';
import type { ManagedSendGateEnv } from '../../lib/sms/managed-send-gate';
import type { PlanQuotaGuard } from '../../features/plan-quota/guard';
import { sendOneSms } from './send-one-sms';

/**
 * The SMS seam injected into deliverSms/flush: resolves a MessagingProvider and
 * the from-number for the given tenant. The shape mirrors loadProviderForTenant's
 * return — { provider, from } — so wiring is a one-liner in the cron entry.
 */
export type SmsRuntime = {
    resolveProvider: (tenantId: string) => Promise<{
        provider: import('../../lib/messaging/provider').MessagingProvider;
        from: string | null;
        /** Twilio Messaging Service SID for managed sends. When set, passes through to sendMessage. */
        messagingServiceSid?: string | null;
    } | null>;
} | null | undefined;

export function AutomationSms<TBase extends Constructor<AutomationBase>>(Base: TBase) {
    return class extends Base {
        /**
         * Track L — deliver one SMS automation log via the shared sendOneSms core.
         * Resolves the rule's referenced SMS message_template first; every guard
         * and the actual send live in sendOneSms. Never throws.
         */
        async deliverSms(
            db: DrizzleD1Database,
            ctx: { log: typeof automationLogs.$inferSelect; automation: typeof automations.$inferSelect;
                   inspection: FlushInspection; tenant: typeof tenants.$inferSelect },
            sms: SmsRuntime,
            appName: string, appHost: string,
            env?: ManagedSendGateEnv,
            quotaGuard?: PlanQuotaGuard,
        ): Promise<void> {
            const { log, automation, inspection, tenant } = ctx;
            const skip = (reason: string) =>
                db.update(automationLogs).set({ status: 'skipped', error: reason })
                    .where(and(eq(automationLogs.id, log.id), eq(automationLogs.tenantId, inspection.tenantId)));

            if (!sms) return void (await skip('sms not configured'));

            const { createOiTemplateStore } = await import('./template-store');
            const tpl = automation.smsTemplateId
                ? await createOiTemplateStore(this.db).resolve(inspection.tenantId, automation.smsTemplateId)
                : null;
            if (!tpl || tpl.channel !== 'sms' || !tpl.body.trim()) return void (await skip('no sms template'));

            await sendOneSms({
                db,
                log,
                inspection,
                tenant,
                bodyTemplate: tpl.body,
                // The rule lives here, so the class is resolved here.
                ...(automationClassId(automation) ? { classId: automationClassId(automation)! } : {}),
                sms,
                appName,
                appHost,
                ...(env ? { env } : {}),
                ...(quotaGuard ? { quotaGuard } : {}),
                ...(this.metering ? { metering: this.metering } : {}),
            });
        }
    };
}
