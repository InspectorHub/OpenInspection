import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { automationLogs, automations, tenants, tenantConfigs, contactRoleProfiles } from '../../lib/db/schema';
import { PRIMARY_CLIENT_KEY } from '../../lib/people/default-role-profiles';
import { logger } from '../../lib/logger';
import { currentPeriodKey } from '../../lib/usage/period';
import { interpolate, type Constructor, type FlushInspection } from './shared';
import { buildBaseTemplateVars } from './template-vars';
import type { AutomationBase } from './shared';
import { managedSendAllowed, type ManagedSendGateEnv } from '../../lib/sms/managed-send-gate';
import type { PlanQuotaGuard } from '../../features/plan-quota/guard';

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
    resolveProvider: (tenantId: string) => Promise<{
        provider: import('../../lib/messaging/provider').MessagingProvider;
        from: string | null;
        /** Twilio Messaging Service SID for managed sends. When set, passes through to sendMessage. */
        messagingServiceSid?: string | null;
    } | null>;
} | null | undefined;

/**
 * SMS delivery mixin — REGULATORY (TCPA consent). This is the SMS-consent flow:
 * client logs are gated on a recorded 'granted' consent event before any text is
 * sent (agents/inspector are implied; D5). The consent gate, opt-in ledger lookup,
 * and the fail-closed review_url guard are kept INTACT and byte-identical — do not
 * alter the consent logic. Renders the rule's referenced SMS message_template
 * (SP2; was the embedded smsBody), calls provider.sendMessage(), maps
 * ok→sent / !ok→failed, and meters a successful send. Never throws.
 */
export function AutomationSms<TBase extends Constructor<AutomationBase>>(Base: TBase) {
    return class extends Base {
        /**
         * Track L — deliver one SMS automation log via the resolved provider. Client
         * logs are gated on a recorded 'granted' consent event (agents/inspector are
         * implied; D5); the provider resolves through the injected sms.resolveProvider
         * (per-tenant Twilio or Telnyx). Renders the rule's referenced SMS
         * message_template with the var map, fail-closed on an unconfigured
         * review_url and on a missing/unresolved template. Maps ok→sent /
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
                   inspection: FlushInspection; tenant: typeof tenants.$inferSelect },
            sms: SmsRuntime,
            appName: string, appHost: string,
            env?: ManagedSendGateEnv,
            quotaGuard?: PlanQuotaGuard,
        ): Promise<void> {
            const { log, automation, inspection, tenant } = ctx;
            const skip = (reason: string) =>
                db.update(automationLogs).set({ status: 'skipped', error: reason }).where(and(eq(automationLogs.id, log.id), eq(automationLogs.tenantId, inspection.tenantId)));

            if (!sms) return void (await skip('sms not configured'));

            // SP2 — resolve the referenced SMS template (was the embedded smsBody,
            // now frozen DEAD). Fail-closed when the rule has no resolvable sms template.
            const { createOiTemplateStore } = await import('./template-store');
            const tpl = automation.smsTemplateId
                ? await createOiTemplateStore(this.db).resolve(inspection.tenantId, automation.smsTemplateId)
                : null;
            if (!tpl || tpl.channel !== 'sms' || !tpl.body.trim()) return void (await skip('no sms template'));

            // Consent gate — client only (agents/inspector implied; D5). Gate
            // fires when the rule's recipient discriminator resolves to the
            // PRIMARY_CLIENT_KEY role profile (replaces the old `recipient ===
            // 'client'` enum check; same consent-required-only-for-client behavior).
            if (automation.recipientKind === 'role' && automation.recipientRoleProfileId) {
                // try/catch (not `.get().catch()`) so this works under both the async
                // D1 driver and the synchronous better-sqlite3 test driver.
                let roleRow: { key: string } | null = null;
                try {
                    roleRow = await db.select({ key: contactRoleProfiles.key }).from(contactRoleProfiles)
                        .where(and(
                            eq(contactRoleProfiles.tenantId, inspection.tenantId),
                            eq(contactRoleProfiles.id, automation.recipientRoleProfileId),
                        )).get() ?? null;
                } catch (err) {
                    // DB error on consent-gate role lookup: fail closed (do not send).
                    // When we cannot prove the recipient is NOT a consent-requiring client, we must not send.
                    logger.error('sms consent-gate role lookup failed; failing closed (skipping send)', {
                        automationId: automation.id,
                        inspectionId: inspection.id,
                        tenantId: inspection.tenantId,
                    }, err instanceof Error ? err : undefined);
                    return void (await skip('consent-gate role lookup failed'));
                }
                if (roleRow?.key === PRIMARY_CLIENT_KEY) {
                    const { SmsConsentService } = await import('../sms-consent.service');
                    const consentSvc = new SmsConsentService(this.db);
                    const contactId = inspection.clientContactId;
                    const latest = contactId ? await consentSvc.getLatest(inspection.tenantId, contactId) : null;
                    if (latest !== 'granted') return void (await skip('no sms consent'));
                }
            }

            const resolved = await sms.resolveProvider(inspection.tenantId);
            if (!resolved) return void (await skip('sms not configured'));
            const { provider, from, messagingServiceSid } = resolved;

            // Load the tenant config row once for the SMS vars: company_phone is used
            // unconditionally by the seeded copy ("questions? call {{company_phone}}"),
            // review_url is the fail-closed consumer below, and smsMode drives the
            // managed-send compliance gate.
            const cfg = await db.select({
                companyPhone: tenantConfigs.companyPhone,
                reviewUrl:    tenantConfigs.reviewUrl,
                smsMode:      tenantConfigs.smsMode,
            }).from(tenantConfigs).where(eq(tenantConfigs.tenantId, inspection.tenantId)).get();

            // Managed-send compliance gate — fail-closed for managed_dedicated and
            // managed_shared tenants whose compliance is not yet approved. own/platform
            // tenants are always allowed. Must run BEFORE the provider sends.
            const gateEnv: ManagedSendGateEnv = env ?? {};
            const gate = await managedSendAllowed(db, gateEnv, inspection.tenantId, cfg?.smsMode ?? 'platform');
            if (!gate.allowed) return void (await skip(gate.reason ?? 'managed_not_approved'));

            // Free-tier pre-flight (2026-07) — alongside the managed-compliance gate
            // above, blocks a free tenant's platform-mode automation sends against the
            // lifetime sms cap BEFORE any provider call. 'own' mode (BYO) is uncapped.
            // `quotaGuard` is undefined on deployments with no usage-quota capability
            // (standalone) — see scheduled.ts wiring. A block throws; the caller's
            // try/catch (AutomationDelivery.flush) marks the log failed with the
            // QuotaExhausted message, mirroring the email path's deliverAction throw.
            if (quotaGuard && cfg?.smsMode !== 'own') {
                await quotaGuard.checkMessagingQuota(inspection.tenantId, tenant.tier, 'sms');
            }

            const vars: Record<string, string> = {
                ...buildBaseTemplateVars(inspection, tenant, appName, appHost),
                company_phone:    cfg?.companyPhone ?? '',
            };
            // review_url fail-closed (same rule as the email path).
            if (tpl.body.includes('{{review_url}}')) {
                if (!cfg?.reviewUrl) return void (await skip('review_url not configured'));
                vars.review_url = cfg.reviewUrl;
            }
            const body = interpolate(tpl.body, vars);

            const sendArgs: { from?: string; to: string; body: string; messagingServiceSid?: string } = { to: log.recipient, body };
            if (from) sendArgs.from = from;
            if (messagingServiceSid) sendArgs.messagingServiceSid = messagingServiceSid;
            const res = await provider.sendMessage(sendArgs);
            if (res.ok) {
                await db.update(automationLogs).set({ status: 'sent', deliveredAt: new Date() })
                    .where(and(eq(automationLogs.id, log.id), eq(automationLogs.tenantId, inspection.tenantId)));
                // WH-2 — seed a 'sent' delivery-status row for the returned message id
                // (non-fatal; the provider status callback advances it later).
                const { recordSentStatus } = await import('../../api/sms');
                await recordSentStatus(db, inspection.tenantId, res.id, Date.now());
                try {
                    // Source tagging (2026-07) — 'own' mode is BYO, tagged 'sms_byo' so
                    // it never counts against the platform free-tier cap.
                    await this.metering?.record(tenant.id, cfg?.smsMode === 'own' ? 'sms_byo' : 'sms', currentPeriodKey(new Date()));
                } catch { /* metering must never break delivery */ }
            } else {
                await db.update(automationLogs).set({ status: 'failed', error: res.error })
                    .where(and(eq(automationLogs.id, log.id), eq(automationLogs.tenantId, inspection.tenantId)));
                logger.error('AutomationService.flush: sms send failed', { logId: log.id });
            }
        }
    };
}
