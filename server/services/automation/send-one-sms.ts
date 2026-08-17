/**
 * Shared one-SMS send core (Communication A3.3).
 *
 * Extracted from `AutomationSms.deliverSms` so the automation flush path and
 * the manual SMS endpoint share ONE status-writing / consent / quota / provider
 * path. Building a second "just send" path that routes around the TCPA gate
 * would be a regulatory failure, not a bug (design §3.5).
 *
 * The GATE CHAIN itself no longer lives here — it moved to
 * `lib/sms/send-gate.ts`, because the two operator test-send paths carried
 * their own copies of it and a copy only has the gates someone remembered to
 * add. What is left here is what a copy could not have shared: the
 * automation_logs row this send belongs to.
 *
 * WHAT THIS STILL OWNS:
 *   - resolving which contact and role KIND the log is addressed to (IA-109),
 *     which the gate then decides on
 *   - review_url fail-closed (when the body template references it)
 *   - per-tenant provider resolution (Twilio / Telnyx)
 *   - status writes, and BYO source tagging (`sms_byo` vs `sms`) on the meter
 *
 * WHAT STAYS WITH THE CALLER:
 *   - inserting the `pending` automation_logs row (trigger() and the manual
 *     endpoint both do this first)
 *   - template resolution — automations use `automation.smsTemplateId`,
 *     manual uses the role profile's `smsTemplateId`; the core receives the
 *     already-chosen body template string
 *
 * Never throws; every unhappy path updates the log to skipped/failed.
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import type { tenants } from '../../lib/db/schema';
import { automationLogs, contactRoleProfiles } from '../../lib/db/schema';
import { resolveSmsSenderIdentity, type SmsSenderIdentityConfig } from '../../lib/sms/sender-identity';
import { PRIMARY_CLIENT_KEY } from '../../lib/people/default-role-profiles';
import { logger } from '../../lib/logger';
import { currentPeriodKey } from '../../lib/usage/period';
import { interpolate, type FlushInspection } from './shared';
import { buildBaseTemplateVars } from './template-vars';
import type { ManagedSendGateEnv } from '../../lib/sms/managed-send-gate';
import { smsSendGate } from '../../lib/sms/send-gate';
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
    log: typeof automationLogs.$inferSelect;
    inspection: FlushInspection;
    tenant: typeof tenants.$inferSelect;
    /** Already-resolved SMS body template (may contain `{{vars}}`). */
    bodyTemplate: string;
    /**
     * The notification class this rule sends, when it is a seeded one.
     *
     * Resolved by the CALLER because that is where the rule is — this function
     * only ever sees the log. A tenant-written rule has no seeded class and so
     * stays unclassified and unmutable, which is `isSuppressible` failing
     * closed rather than an oversight.
     */
    classId?: string | undefined;
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
    const { classId } = args;
    const {
        db, log, inspection, tenant, bodyTemplate, sms,
        appName, appHost, env, quotaGuard, metering,
    } = args;

    const skip = (reason: string) =>
        db.update(automationLogs).set({ status: 'skipped', error: reason })
            .where(and(eq(automationLogs.id, log.id), eq(automationLogs.tenantId, inspection.tenantId)));

    // The gate chain lives in ONE place now (`lib/sms/send-gate.ts`) so the
    // template test-send and the settings test-connection run the same one.
    // Three copies is how the STOP-revocation check ended up in only this path.
    //
    // What stays here is what is specific to an automation_logs row: which
    // contact it is addressed to, and which role kind that contact holds.
    const roleKind = await resolveRecipientRoleKind(db, inspection.tenantId, log.recipientRoleKey);
    // The contact this log is addressed to, stamped at enqueue.
    //
    // Legacy rows predate that column. `inspection.clientContactId` is the
    // PRIMARY client — a correct fallback for a log explicitly keyed to the
    // primary client, and for an older log with no role key at all (which
    // could only ever have been the primary client).
    //
    // For any OTHER client-kind role it names the wrong person — those fall
    // through to the number match, and then fail closed on express consent.
    const isPrimaryClientLog =
        log.recipientRoleKey === PRIMARY_CLIENT_KEY || log.recipientRoleKey == null;
    const contactId = log.recipientContactId
        ?? (isPrimaryClientLog ? inspection.clientContactId : null);

    const gate = await smsSendGate({
        db,
        tenantId: inspection.tenantId,
        to: log.recipient,
        purpose: 'notification',
        contactId,
        roleKind,
        env,
        // The un-interpolated body, so the gate can refuse marketing content on
        // this channel. A tenant-written rule has no seeded class, so the
        // category check cannot see it and this is the only thing that can.
        bodyTemplate,
        // Lets the gate consult this recipient's own preference. Without it the
        // screen grows a text switch that writes a row nothing reads.
        ...(classId ? { classId } : {}),
        ...(quotaGuard ? { quota: { guard: quotaGuard, tier: tenant.tier } } : {}),
    });
    if (!gate.allowed) return void (await skip(gate.reason));

    const resolved = await sms.resolveProvider(inspection.tenantId);
    if (!resolved) return void (await skip('sms not configured'));
    const { provider, from, messagingServiceSid } = resolved;

    const vars: Record<string, string> = {
        ...buildBaseTemplateVars(inspection, tenant, appName, appHost),
        company_phone: gate.companyPhone ?? '',
    };
    // SUBORDINATE TO THE GATE, and no longer the first answer. The gate refuses
    // any body referencing a marketing variable, and that token is one — so a
    // template reaching this line means the gate's denylist and this condition
    // have diverged. Kept as the second line rather than deleted: it fails
    // closed, and the cost of keeping it is one comparison.
    if (bodyTemplate.includes('{{review_url}}')) {
        if (!gate.reviewUrl) return void (await skip('review_url not configured'));
        vars.review_url = gate.reviewUrl;
    }
    const body = interpolate(bodyTemplate, vars);

    const sendArgs: { from?: string; to: string; body: string; messagingServiceSid?: string } = {
        to: log.recipient, body,
    };
    if (from) sendArgs.from = from;
    if (messagingServiceSid) sendArgs.messagingServiceSid = messagingServiceSid;
    const res = await provider.sendMessage(sendArgs);
    if (res.ok) {
        // WHO SENT IT and ON WHOSE BEHALF, snapshotted at send time (counsel
        // 26-5). Both were previously answerable only by reading `sms_mode` off
        // the tenant config AS IT IS TODAY — which answers a question about last
        // year's message with this year's configuration. Written alongside the
        // outcome, in the same statement, so a sent row can never lack it.
        const senderIdentity = resolveSmsSenderIdentity(
            { smsMode: gate.smsMode as SmsSenderIdentityConfig['smsMode'], companyName: gate.companyName },
            inspection.tenantId,
        );
        await db.update(automationLogs)
            .set({ status: 'sent', deliveredAt: new Date(), senderIdentity })
            .where(and(eq(automationLogs.id, log.id), eq(automationLogs.tenantId, inspection.tenantId)));
        const { recordSentStatus } = await import('../../api/sms');
        await recordSentStatus(db, inspection.tenantId, res.id, Date.now());
        try {
            await metering?.record(tenant.id, gate.smsMode === 'own' ? 'sms_byo' : 'sms', currentPeriodKey(new Date()));
        } catch { /* metering must never break delivery */ }
    } else {
        await db.update(automationLogs).set({ status: 'failed', error: res.error })
            .where(and(eq(automationLogs.id, log.id), eq(automationLogs.tenantId, inspection.tenantId)));
        logger.error('sendOneSms: sms send failed', { logId: log.id });
    }
}
