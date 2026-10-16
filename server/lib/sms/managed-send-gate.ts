import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { messagingCompliance, usageCounters, tenantConfigs } from '../db/schema';
import { currentPeriodKey } from '../usage/period';
import type { DeploymentProfile } from '../deployment-profile';
import { isRetiredSenderMode, loadOwnSmsAccountComplete } from './own-account';

/**
 * Default monthly SMS allowance for managed tenants when
 * MANAGED_SMS_MONTHLY_ALLOWANCE is absent or non-numeric.
 */
export const DEFAULT_MANAGED_SMS_ALLOWANCE = 1000;

/**
 * Minimal env shape the gate needs: the monthly SMS allowance cap.
 * Safe to pass any superset (AppEnv, TwilioLoaderEnv, etc.).
 */
export interface ManagedSendGateEnv {
    /** Monthly SMS allowance for dedicated-number companies (string-encoded integer).
     *  Parsed at gate-check time; defaults to DEFAULT_MANAGED_SMS_ALLOWANCE when absent
     *  or non-numeric. */
    MANAGED_SMS_MONTHLY_ALLOWANCE?: string;
    /** Tells a hosted deployment from a self-hosted one. */
    APP_MODE?: string;
    /** A profile the caller already resolved; wins over APP_MODE. */
    profile?: DeploymentProfile;
    /**
     * Needed to open the company's stored keys. A company on a retired sender mode
     * is allowed only when its own account is complete; without DB and JWT_SECRET the
     * keys cannot be read and the answer is "not configured".
     */
    DB?: D1Database;
    TENANT_CACHE?: KVNamespace;
    JWT_SECRET?: string;
    JWT_SECRET_PREVIOUS?: string;
}

export interface ManagedSendGateResult {
    allowed: boolean;
    /** Present only when allowed=false. */
    reason?: string;
    /** Set when a retired stored mode was allowed because the own account is complete: the send runs as `own`. */
    resolvedMode?: 'own';
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
 * managed_shared (retired shared sender), and `platform` on a hosted deployment:
 *   Refused as 'sms not configured' -- the same reason a send gets when no
 *   provider resolves. The stored value is left as it is.
 *
 * own, and `platform` on a self-hosted deployment (the operator's own account):
 *   Always allowed.
 *
 * This gate is INDEPENDENT of the per-recipient consent gate and must
 * run before any provider call so a blocked send makes NO Twilio call.
 *
 * @param db        - Tenant-bound Drizzle instance (caller's existing instance). Used for
 *                    both the compliance-status lookup and the quota counter read.
 * @param env       - Worker env (MANAGED_SMS_MONTHLY_ALLOWANCE read).
 * @param tenantId  - The tenant whose compliance status to check.
 * @param smsMode   - The tenant's configured SMS mode.
 */
export async function managedSendAllowed(
    db: DrizzleD1Database,
    env: ManagedSendGateEnv,
    tenantId: string,
    smsMode: string,
): Promise<ManagedSendGateResult> {
    // There is no shared SMS number. The retired shared mode, and `platform` on a
    // hosted deployment, would send on one, so they are refused with the same
    // reason a send gets when no provider resolves. An own account and a
    // registered number (managed_dedicated, checked below) are the supported
    // paths. On a self-hosted deployment `platform` is the operator's own
    // account and is unaffected.
    // A retired mode with a COMPLETE own account of the company's is simply `own`.
    if (isRetiredSenderMode(env, smsMode)) {
        if (!env.DB || !env.JWT_SECRET) return { allowed: false, reason: 'sms not configured' };
        const byo = await (async () => {
            try {
                const row = await db.select({ byo: tenantConfigs.smsByoProvider }).from(tenantConfigs)
                    .where(eq(tenantConfigs.tenantId, tenantId)).get();
                return row?.byo ?? null;
            } catch { return null; }
        })();
        const complete = await loadOwnSmsAccountComplete(
            { DB: env.DB, TENANT_CACHE: env.TENANT_CACHE, JWT_SECRET: env.JWT_SECRET, ...(env.JWT_SECRET_PREVIOUS ? { JWT_SECRET_PREVIOUS: env.JWT_SECRET_PREVIOUS } : {}) },
            tenantId, byo,
        );
        return complete ? { allowed: true, resolvedMode: 'own' } : { allowed: false, reason: 'sms not configured' };
    }

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

    // own / self-hosted platform -- always allowed.
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
