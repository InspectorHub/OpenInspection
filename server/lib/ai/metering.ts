/**
 * The two halves of "check before, meter after" for AI, built once per request
 * and injected into AIService.
 *
 * Deliberately NOT a second metering system: it writes through the same
 * `MeteringService` into the same `usage_counters` table under the same
 * `currentPeriodKey` bucket as sms/email, and it is wired at exactly one
 * chokepoint — the single method every AI feature funnels through. The email
 * pipeline learned this the expensive way: one unified interface is the meter,
 * and any counter added beside it becomes a second number that must agree with
 * the first and eventually doesn't.
 *
 * The pre-flight is separate from the meter and shaped like the email one
 * (`lib/email/build-email-service.ts`: `{ preflight }` beside `{ record }`) for
 * the reason stated on `PlanQuotaGuard.checkAiQuota` — the check is read-only,
 * so a model call that failed never consumes an allowance it did not spend.
 * AI calls fail more often than sends, which makes that ordering matter more
 * here, not less.
 *
 * The credential source that tags the metric and selects the cap comes from
 * `resolveAi` — the same resolver the runtime uses to decide which key the call
 * runs on — rather than from a separate "is this managed?" test that could
 * disagree with it.
 */
import { MeteringService } from '../../services/metering.service';
import { aiUsageMetric, currentPeriodKey, managedAiMetric, type AiUsageKind } from '../usage/period';
import { resolveAi, isRefusal, type AiCredentialSource } from './resolve-provider';
import { isPaidPlan, type TenantPlan } from '../../features/plan-quota/policy';
import type { PlanQuotaGuard } from '../../features/plan-quota/guard';
import type { DeploymentProfile } from '../deployment-profile';

export interface AiMeter {
    record(kind: AiUsageKind): Promise<void>;
}

/** Read-only pre-flight against the tenant's platform allowance. Built only
 *  when there IS an allowance to check — see `buildAiQuotaPreflight`. */
export interface AiQuotaPreflight {
    preflight(kind: AiUsageKind): Promise<void>;
}

/**
 * The runtime's answer to "whose credentials would this tenant's AI call run
 * on?" — 'managed', 'byo', or null for "the feature is off / unconfigured".
 *
 * This is the ONE place the paid-tier entitlement is decided, shared by the
 * meter below, by the capability gate and provenance sink the composition point
 * builds from the same answer, and by `GET /api/integration/ai-provisioning`
 * (portal's provisioning console read) — so the count portal renders and the
 * metric the meter tags can never come from two resolvers that disagree.
 *
 * ⚠️ THIS FUNCTION IS PORTAL-FACING THROUGH THAT LAST CONSUMER. Changing what
 * it answers repaints an operator console in a different repository, in the
 * same commit, with no portal deploy.
 *
 * ⚠️ STILL OWED BEFORE MANAGED OUTPUT IS RELEASED: an entitled tenant resolves
 * `managed` here, but the composition point hands AIService the TENANT's key
 * and nothing else, so a managed call has no credential behind it. Nothing is
 * broken today because the capability gate refuses every managed output class
 * (`lib/ai/output-classification.ts`) long before a key would be needed —
 * releasing one of those classes without first handing the service the resolved
 * provider turns a refusal into "AI is not configured".
 */
export function resolveRuntimeAiSource(args: {
    profile: DeploymentProfile;
    tenantKey: string | null;
    managedKey: string | null;
    model: string;
    /** The tenant's commercial standing, or null when it could not be read.
     *  Null is not an entitlement — see `isPaidPlan`. */
    plan: TenantPlan | null;
    /**
     * `tenant_configs.is_ai_enabled`, when the caller has read it.
     *
     * Optional, and TRUE when omitted, because this function answers a
     * PROVISIONING question — "whose credentials WOULD fund a call for this
     * workspace" — and the provisioning console asks it about every workspace
     * without reading their settings row. A workspace that switched AI off is
     * still a workspace with its own key configured, and bucketing it as
     * `unconfigured` would misreport what is provisioned.
     *
     * The off switch is a RUNTIME-PERMISSION question, refused by `resolveAi`
     * at the point a provider is actually built. The caller that builds one
     * passes the real value.
     */
    aiEnabled?: boolean;
}): AiCredentialSource | null {
    const resolved = resolveAi({
        profile: args.profile,
        aiEnabled: args.aiEnabled ?? true,
        tenantKey: args.tenantKey,
        managedKey: args.managedKey,
        // Entitlement is a property of the PLAN, answered here and nowhere
        // else. `resolveAi` still receives a boolean and never learns what
        // grants it, which is what keeps packaging out of the resolver.
        managedEntitled: isPaidPlan(args.plan),
        underCap: true,
        model: args.model,
    });
    // A refusal has no credential source to tag. Callers keep the `null` they
    // always had here — the REASON is for the person the refusal is shown to,
    // and a usage metric has nobody to show it to.
    return isRefusal(resolved) ? null : resolved.source;
}

export function buildAiMeter(args: {
    db: D1Database;
    tenantId: string | null;
    source: AiCredentialSource;
}): AiMeter | undefined {
    const { db, tenantId, source } = args;
    // No tenant to attribute usage to (public/unauthenticated paths): no meter,
    // rather than a row nobody can bill, explain, or delete.
    if (!tenantId) return undefined;

    const metering = new MeteringService(db);
    return {
        record: (kind) => metering.record(tenantId, aiUsageMetric(kind, source), currentPeriodKey(new Date())),
    };
}

/**
 * The pre-flight, or `undefined` when there is nothing this deployment could
 * enforce.
 *
 * Four ways to get `undefined`, and each is a real state rather than a
 * defensive shrug:
 *   - `source !== 'managed'` — bring-your-own volume is the tenant's own bill,
 *     so there is no deployment allowance for it to be over.
 *   - no guard — standalone; there is no platform funding anything.
 *   - no tenant — public paths, which the meter also skips.
 *   - no plan — the tier a cap is looked up under is unknown, and guessing one
 *     would enforce somebody else's allowance. This cannot co-occur with
 *     `source === 'managed'`, because entitlement is derived from that same
 *     plan; it is stated so the invariant survives a future caller.
 */
export function buildAiQuotaPreflight(args: {
    guard: PlanQuotaGuard | undefined;
    tenantId: string | null;
    source: AiCredentialSource;
    plan: TenantPlan | null;
}): AiQuotaPreflight | undefined {
    const { guard, tenantId, source, plan } = args;
    if (source !== 'managed' || !guard || !tenantId || !plan) return undefined;
    return { preflight: (kind) => guard.checkAiQuota(tenantId, plan.tier, managedAiMetric(kind)) };
}
