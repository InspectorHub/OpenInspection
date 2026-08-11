import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { messagingCompliance, usageCounters } from '../db/schema';
import { currentPeriodKey } from '../usage/period';

/**
 * Default monthly SMS allowance for managed tenants when
 * MANAGED_SMS_MONTHLY_ALLOWANCE is absent or non-numeric.
 */
export const DEFAULT_MANAGED_SMS_ALLOWANCE = 1000;

/**
 * Minimal env shape the gate needs: the shared-pool SID for the
 * managed_shared branch, and the monthly SMS allowance cap.
 * Safe to pass any superset (AppEnv, TwilioLoaderEnv, etc.).
 */
export interface ManagedSendGateEnv {
    /** Shared Messaging Service SID used by all managed_shared tenants.
     *  Its presence signals that the platform's shared pool is provisioned
     *  and toll-free verified (TFV approved). Absent → gate blocks shared sends. */
    TWILIO_SHARED_MESSAGING_SERVICE_SID?: string;
    /** Platform-wide monthly SMS allowance for managed tenants (string-encoded integer).
     *  Parsed at gate-check time; defaults to DEFAULT_MANAGED_SMS_ALLOWANCE when absent
     *  or non-numeric. */
    MANAGED_SMS_MONTHLY_ALLOWANCE?: string;
}

export interface ManagedSendGateResult {
    allowed: boolean;
    /** Present only when allowed=false. */
    reason?: string;
}

/**
 * ⚠️ THERE IS DELIBERATELY NO 24-HOUR COOLING WINDOW ON SMS (portal #98 §3.2).
 *
 * The email side gained one; this file is where somebody will come looking to
 * add the matching SMS rule, so the answer lives here rather than in a
 * document.
 *
 * Platform-funded SMS already requires `complianceStatus === 'approved'`
 * below, which means carrier registration (10DLC / TFV) with a legal business
 * name, address and responsible party. That takes DAYS and a real business
 * identity. A 24-hour gate in front of a multi-day gate blocks nothing that is
 * not already blocked — it is a no-op that READS like a second defence, which
 * is worse than no defence, because the next reader counts it as one.
 *
 * If the approval requirement is ever relaxed, this reasoning expires with it.
 */

/**
 * Fail-closed send gate for managed SMS tenants.
 *
 * managed_dedicated:
 *   Reads messaging_compliance.complianceStatus for tenantId.
 *   Allowed ONLY when complianceStatus === 'approved'.
 *   Missing row → not approved → blocked (fail-closed).
 *   After approval check passes, reads current-period SMS counter and blocks
 *   when count >= MANAGED_SMS_MONTHLY_ALLOWANCE (default 1000).
 *
 * managed_shared:
 *   Platform-level TFV gate: allowed ONLY when
 *   TWILIO_SHARED_MESSAGING_SERVICE_SID is set in env.
 *   Its presence means the platform provisioned the shared pool and
 *   obtained TFV approval. Absent → blocked (managed_not_approved).
 *   After approval check passes, applies the same monthly quota check.
 *
 * own / platform:
 *   Always allowed — no behavior change.
 *
 * This gate is INDEPENDENT of the per-recipient consent gate and must
 * run before any provider call so a blocked send makes NO Twilio call.
 *
 * @param db        - Tenant-bound Drizzle instance (caller's existing instance). Used for
 *                    both the compliance-status lookup and the quota counter read.
 * @param env       - Worker env (TWILIO_SHARED_MESSAGING_SERVICE_SID + MANAGED_SMS_MONTHLY_ALLOWANCE read).
 * @param tenantId  - The tenant whose compliance status to check.
 * @param smsMode   - The tenant's configured SMS mode.
 */
export async function managedSendAllowed(
    db: DrizzleD1Database,
    env: ManagedSendGateEnv,
    tenantId: string,
    smsMode: string,
): Promise<ManagedSendGateResult> {
    if (smsMode === 'managed_dedicated') {
        // Fail-closed: missing row → not approved → block.
        let row: { complianceStatus: string } | null | undefined;
        try {
            row = await db
                .select({ complianceStatus: messagingCompliance.complianceStatus })
                .from(messagingCompliance)
                .where(eq(messagingCompliance.tenantId, tenantId))
                .get();
        } catch { row = null; }
        if (row?.complianceStatus !== 'approved') {
            return { allowed: false, reason: 'managed_not_approved' };
        }
        // Compliance approved — check monthly quota.
        return checkManagedQuota(db, env, tenantId);
    }

    if (smsMode === 'managed_shared') {
        // Platform-TFV gate: TWILIO_SHARED_MESSAGING_SERVICE_SID being set means
        // the platform's shared pool is provisioned and approved.
        if (!env.TWILIO_SHARED_MESSAGING_SERVICE_SID) {
            return { allowed: false, reason: 'managed_not_approved' };
        }
        // Approved — check monthly quota.
        return checkManagedQuota(db, env, tenantId);
    }

    // own / platform — always allowed.
    return { allowed: true };
}

/**
 * Read the current-period SMS counter via the drizzle db and compare against
 * the configured allowance. Returns { allowed: false, reason: 'managed_quota_exceeded' }
 * when the tenant has reached or exceeded their monthly allowance. Read-only — never
 * increments the counter (that is the caller's responsibility after a successful send).
 */
async function checkManagedQuota(
    db: DrizzleD1Database,
    env: ManagedSendGateEnv,
    tenantId: string,
): Promise<ManagedSendGateResult> {
    const allowanceRaw = parseInt(env.MANAGED_SMS_MONTHLY_ALLOWANCE ?? '', 10);
    const allowance = Number.isFinite(allowanceRaw) && allowanceRaw > 0
        ? allowanceRaw
        : DEFAULT_MANAGED_SMS_ALLOWANCE;

    const period = currentPeriodKey(new Date());
    let row: { value: number } | undefined;
    try {
        row = await db.select({ value: usageCounters.value })
            .from(usageCounters)
            .where(and(
                eq(usageCounters.tenantId, tenantId),
                eq(usageCounters.metric, 'sms'),
                eq(usageCounters.periodKey, period),
            ))
            .get() ?? undefined;
    } catch { row = undefined; }
    const count = row?.value ?? 0;
    if (count >= allowance) {
        return { allowed: false, reason: 'managed_quota_exceeded' };
    }
    return { allowed: true };
}
