/**
 * Shared one-SMS send core (Communication A3.3).
 *
 * Extracted from `AutomationSms.deliverSms` so the automation flush path and
 * the manual SMS endpoint share ONE status-writing / consent / quota / provider
 * path. Building a second "just send" path that routes around the TCPA gate
 * would be a regulatory failure, not a bug (design §3.5).
 *
 * WHAT MOVED HERE, UNCHANGED from deliverSms:
 *   - TCPA consent gate (kind-based, IA-109) + recipient_contact_id lookup
 *   - review_url fail-closed (when the body template references it)
 *   - managedSendAllowed fail-closed for unapproved managed_* tenants
 *   - per-tenant provider resolution (Twilio / Telnyx)
 *   - PlanQuotaGuard pre-flight (platform mode)
 *   - BYO source tagging (`sms_byo` vs `sms`) on successful meter
 *
 * WHAT STAYS WITH THE CALLER:
 *   - inserting the `pending` automation_logs row (trigger() and the manual
 *     endpoint both do this first)
 *   - template resolution — automations use `automation.smsTemplateId`,
 *     manual uses the role profile's `smsTemplateId`; the core receives the
 *     already-chosen body template string
 *
 * Diff the body of `sendOneSms` against the pre-extraction `deliverSms` when
 * reviewing — the consent / gate / meter lines must be byte-identical in
 * intent. Never throws; every unhappy path updates the log to skipped/failed.
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import type { tenants } from '../../lib/db/schema';
import { automationLogs, tenantConfigs, contactRoleProfiles } from '../../lib/db/schema';
import { PRIMARY_CLIENT_KEY } from '../../lib/people/default-role-profiles';
import { logger } from '../../lib/logger';
import { currentPeriodKey } from '../../lib/usage/period';
import { interpolate, type FlushInspection } from './shared';
import { buildBaseTemplateVars } from './template-vars';
import { managedSendAllowed, type ManagedSendGateEnv } from '../../lib/sms/managed-send-gate';
import { requiresExpressSmsConsent } from '../../lib/sms/consent-basis';
import type { RoleKind } from '../../lib/people/role-kinds';
import type { PlanQuotaGuard } from '../../features/plan-quota/guard';
import type { UsageMetric } from '../../lib/usage/period';

/** Non-null SMS runtime — the core refuses to run without a resolved provider seam. */
type SmsProviderSeam = {
    resolveProvider: (tenantId: string) => Promise<{
        provider: import('../../lib/messaging/provider').MessagingProvider;
        from: string | null;
        messagingServiceSid?: string | null;
    } | null>;
};

export type SendOneSmsArgs = {
    // Callers pass tenant-scoped drizzle handles with different schema maps;
    // the core only touches a handful of tables by name.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: DrizzleD1Database<any>;
    /** Raw D1 handle — SmsConsentService still takes the binding, not drizzle. */
    rawDb: D1Database;
    log: typeof automationLogs.$inferSelect;
    inspection: FlushInspection;
    tenant: typeof tenants.$inferSelect;
    /** Already-resolved SMS body template (may contain `{{vars}}`). */
    bodyTemplate: string;
    sms: SmsProviderSeam;
    appName: string;
    appHost: string;
    env?: ManagedSendGateEnv | undefined;
    quotaGuard?: PlanQuotaGuard | undefined;
    metering?: {
        record: (tenantId: string, metric: UsageMetric, periodKey: string, delta?: number) => Promise<void>;
    } | undefined;
};

/**
 * Resolve the role KIND behind a log's `recipientRoleKey` (IA-109).
 *
 * FAILS CLOSED — an unresolvable key returns 'client', which is the gated
 * answer. Getting this wrong in the permissive direction texts a consumer
 * without recorded consent. `inspector` has no role-profile row and is
 * explicitly implied-consent (D5) → 'other'.
 */
async function resolveRecipientRoleKind(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: DrizzleD1Database<any>,
    tenantId: string,
    roleKey: string | null,
): Promise<RoleKind> {
    if (roleKey === 'inspector') return 'other';
    if (!roleKey) return 'client';
    if (roleKey === PRIMARY_CLIENT_KEY) return 'client';
    try {
        const row = await db
            .select({ kind: contactRoleProfiles.kind })
            .from(contactRoleProfiles)
            .where(and(
                eq(contactRoleProfiles.tenantId, tenantId),
                eq(contactRoleProfiles.key, roleKey),
            ))
            .get();
        return (row?.kind as RoleKind | undefined) ?? 'client';
    } catch (err) {
        logger.warn('[send-one-sms] role-kind lookup failed; treating as client (fail closed)', {
            tenantId, roleKey, error: err instanceof Error ? err.message : String(err),
        });
        return 'client';
    }
}

export async function sendOneSms(args: SendOneSmsArgs): Promise<void> {
    const {
        db, rawDb, log, inspection, tenant, bodyTemplate, sms,
        appName, appHost, env, quotaGuard, metering,
    } = args;

    const skip = (reason: string) =>
        db.update(automationLogs).set({ status: 'skipped', error: reason })
            .where(and(eq(automationLogs.id, log.id), eq(automationLogs.tenantId, inspection.tenantId)));

    // Consent gate. Two DIFFERENT rules, and conflating them is what let a
    // revoked agent keep receiving texts:
    //
    //   - **Revocation binds everyone.** Honoring STOP does not depend on the
    //     basis the first message was sent under — it is the one CTIA rule that
    //     is universal, and both published documents warrant it (ToS: STOP is
    //     honored "for all outbound recipients"; privacy notice: business
    //     counterparties keep STOP available). The inbound webhook matches
    //     contacts by PHONE with no kind filter, so it records revocations for
    //     agents and other business counterparties too — they were simply never
    //     read, because this whole block used to sit inside the express branch.
    //   - **Express consent is required only of consumers** (client kind).
    //     Agents / other business counterparties / staff are implied
    //     (D5 + A3.2); absence of a granted row is not a reason to withhold.
    //
    // Keyed on the PER-RECIPIENT role stamped on the log, not the rule's
    // recipientKind. IA-109: gate on KIND, not one KEY.
    const roleKind = await resolveRecipientRoleKind(db, inspection.tenantId, log.recipientRoleKey);
    {
        const { SmsConsentService } = await import('../sms-consent.service');
        const consentSvc = new SmsConsentService(rawDb);
        // The contact this log is addressed to, stamped at enqueue.
        //
        // Legacy rows predate that column. `inspection.clientContactId` is the
        // PRIMARY client — a correct fallback for a log explicitly keyed to the
        // primary client, and for an older log with no role key at all (which
        // could only ever have been the primary client).
        //
        // For any OTHER client-kind role it names the wrong person — those fail
        // closed instead of consulting the primary client's consent.
        const isPrimaryClientLog =
            log.recipientRoleKey === PRIMARY_CLIENT_KEY || log.recipientRoleKey == null;
        const contactId = log.recipientContactId
            ?? (isPrimaryClientLog ? inspection.clientContactId : null);

        if (!contactId) {
            // No identifiable contact: a consumer fails closed (nothing to check
            // consent against). An implied-basis recipient has no ledger to
            // consult either, so there is no revocation that could apply.
            if (requiresExpressSmsConsent(roleKind)) return void (await skip('no sms consent'));
        } else {
            const latest = await consentSvc.getLatest(inspection.tenantId, contactId);
            // Distinct reason string: "opted out" and "never opted in" are
            // different facts, and the Outbox/inbox reason maps read them.
            if (latest === 'revoked') return void (await skip('sms opt-out'));
            if (requiresExpressSmsConsent(roleKind) && latest !== 'granted') {
                return void (await skip('no sms consent'));
            }
        }
    }

    const resolved = await sms.resolveProvider(inspection.tenantId);
    if (!resolved) return void (await skip('sms not configured'));
    const { provider, from, messagingServiceSid } = resolved;

    const cfg = await db.select({
        companyPhone: tenantConfigs.companyPhone,
        reviewUrl:    tenantConfigs.reviewUrl,
        smsMode:      tenantConfigs.smsMode,
    }).from(tenantConfigs).where(eq(tenantConfigs.tenantId, inspection.tenantId)).get();

    const gateEnv: ManagedSendGateEnv = env ?? {};
    const gate = await managedSendAllowed(db, gateEnv, inspection.tenantId, cfg?.smsMode ?? 'platform');
    if (!gate.allowed) return void (await skip(gate.reason ?? 'managed_not_approved'));

    if (quotaGuard && cfg?.smsMode !== 'own') {
        await quotaGuard.checkMessagingQuota(inspection.tenantId, tenant.tier, 'sms');
    }

    const vars: Record<string, string> = {
        ...buildBaseTemplateVars(inspection, tenant, appName, appHost),
        company_phone: cfg?.companyPhone ?? '',
    };
    if (bodyTemplate.includes('{{review_url}}')) {
        if (!cfg?.reviewUrl) return void (await skip('review_url not configured'));
        vars.review_url = cfg.reviewUrl;
    }
    const body = interpolate(bodyTemplate, vars);

    const sendArgs: { from?: string; to: string; body: string; messagingServiceSid?: string } = {
        to: log.recipient, body,
    };
    if (from) sendArgs.from = from;
    if (messagingServiceSid) sendArgs.messagingServiceSid = messagingServiceSid;
    const res = await provider.sendMessage(sendArgs);
    if (res.ok) {
        await db.update(automationLogs).set({ status: 'sent', deliveredAt: new Date() })
            .where(and(eq(automationLogs.id, log.id), eq(automationLogs.tenantId, inspection.tenantId)));
        const { recordSentStatus } = await import('../../api/sms');
        await recordSentStatus(db, inspection.tenantId, res.id, Date.now());
        try {
            await metering?.record(tenant.id, cfg?.smsMode === 'own' ? 'sms_byo' : 'sms', currentPeriodKey(new Date()));
        } catch { /* metering must never break delivery */ }
    } else {
        await db.update(automationLogs).set({ status: 'failed', error: res.error })
            .where(and(eq(automationLogs.id, log.id), eq(automationLogs.tenantId, inspection.tenantId)));
        logger.error('sendOneSms: sms send failed', { logId: log.id });
    }
}
