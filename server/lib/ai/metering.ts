/**
 * The AI usage meter, built once per request and injected into AIService.
 *
 * Deliberately NOT a second metering system: it writes through the same
 * `MeteringService` into the same `usage_counters` table under the same
 * `currentPeriodKey` bucket as sms/email, and it is wired at exactly one
 * chokepoint — the single method every AI feature funnels through. The email
 * pipeline learned this the expensive way: one unified interface is the meter,
 * and any counter added beside it becomes a second number that must agree with
 * the first and eventually doesn't.
 *
 * The credential source that tags the metric comes from `resolveAi` — the same
 * resolver the runtime uses to decide which key the call runs on — rather than
 * from a separate "is this managed?" test that could disagree with it.
 */
import { MeteringService } from '../../services/metering.service';
import { aiUsageMetric, currentPeriodKey, type AiUsageKind } from '../usage/period';
import { resolveAi, type AiCredentialSource } from './resolve-provider';
import type { DeploymentProfile } from '../deployment-profile';

export interface AiMeter {
    record(kind: AiUsageKind): Promise<void>;
}

/**
 * The runtime's answer to "whose credentials would this tenant's AI call run
 * on?" — 'managed', 'byo', or null for "the feature is off / unconfigured".
 *
 * This is the ONE place the not-yet-granted entitlement literal lives, shared
 * by the meter below and by `GET /api/integration/ai-provisioning` (portal's
 * provisioning console read), so the count portal renders and the metric the
 * meter tags can never come from two resolvers that disagree.
 */
export function resolveRuntimeAiSource(args: {
    profile: DeploymentProfile;
    tenantKey: string | null;
    managedKey: string | null;
    model: string;
}): AiCredentialSource | null {
    const resolved = resolveAi({
        profile: args.profile,
        tenantKey: args.tenantKey,
        managedKey: args.managedKey,
        // Entitlement is delivered as configuration, not decided here. Until it
        // arrives no tenant resolves managed, so managed metrics simply have no
        // producer yet — the meter is correct either way, and flipping this to
        // a real value is the only change needed on that day. AIService must
        // take the RESOLVED PROVIDER at that point rather than a raw key.
        managedEntitled: false,
        underCap: true,
        model: args.model,
    });
    return resolved?.source ?? null;
}

export function buildAiMeter(args: {
    db: D1Database;
    profile: DeploymentProfile;
    tenantId: string | null;
    tenantKey: string | null;
    managedKey: string | null;
    model: string;
}): AiMeter | undefined {
    const { db, tenantId } = args;
    // No tenant to attribute usage to (public/unauthenticated paths): no meter,
    // rather than a row nobody can bill, explain, or delete.
    if (!tenantId) return undefined;

    // null (feature off / unconfigured) tags as 'byo': an unresolvable call
    // never reaches a provider, so the tag only matters for the defensive case
    // — and the defensive choice is the metric that is the tenant's own bill.
    const source = resolveRuntimeAiSource({
        profile: args.profile,
        tenantKey: args.tenantKey,
        managedKey: args.managedKey,
        model: args.model,
    }) ?? 'byo';

    const metering = new MeteringService(db);
    return {
        record: (kind) => metering.record(tenantId, aiUsageMetric(kind, source), currentPeriodKey(new Date())),
    };
}
