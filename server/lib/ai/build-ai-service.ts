/**
 * Assemble the per-request AIService from ONE credential resolution.
 *
 * Modelled on `lib/email/build-email-service.ts`, and here for the same two
 * reasons. First, four seams have to agree about whose key funds a call — the
 * meter's tag, the capability gate's source, the provenance row's mode, and the
 * quota pre-flight's cap — and the only way they cannot disagree is if the
 * question is asked once and the answer handed to all four. Second, that
 * assembly does not belong inside the DI middleware's service switch: it is a
 * policy decision with four dependencies, not a `new`.
 *
 * Nothing here reads deployment mode. Whether a managed credential may exist at
 * all is `profile.hasManagedAi`, answered inside `resolveAi`; whether the dev
 * mock stands in for a missing key is `profile.aiDevMockFallback`.
 */
import { AIService } from '../../services/ai.service';
import { buildAiMeter, buildAiQuotaPreflight } from './metering';
import { resolveAi, isRefusal } from './resolve-provider';
import { isPaidPlan } from '../../features/plan-quota/policy';
import { buildAiProvenanceSink } from './provenance';
import type { PlanQuotaGuard } from '../../features/plan-quota/guard';
import type { TenantPlan } from '../../features/plan-quota/policy';
import type { DeploymentProfile } from '../deployment-profile';

interface BuildAiServiceArgs {
    db: D1Database;
    profile: DeploymentProfile;
    /** Null on public/unauthenticated paths: no meter, no provenance sink, and
     *  therefore a service that refuses to run rather than one that runs
     *  unrecorded. */
    tenantId: string | null;
    /** The workspace's own stored key (Settings → Advanced → AI), or null. */
    tenantKey: string | null;
    /** The deployment-provided key, when one has been provisioned. */
    managedKey: string | null;
    /** `AI_MODEL`. Empty fails closed at the service, never with a default. */
    model: string;
    /** The tenant's commercial standing, or null when it was not read. Null is
     *  not an entitlement. */
    plan: TenantPlan | null;
    /** Whether a confirmation record is on file for the tenant's OWN key.
     *  Unloaded config must arrive here as `false` — the gate is fail-closed. */
    tenantKeyAttested: boolean;
    /** Absent on deployments with no usage quota (standalone), which is what
     *  makes AI enforcement absent there rather than disabled by a flag. */
    quotaGuard: PlanQuotaGuard | undefined;
    /** `tenant_configs.is_ai_enabled`. False = the workspace switched AI off;
     *  their key, endpoint and model stay stored and stay valid. */
    aiEnabled: boolean;
    /** The workspace's own endpoint and model, when they configured them.
     *  Null falls back to the deployment default below. */
    tenantBaseUrl: string | null;
    tenantModel: string | null;
    /** `AI_BASE_URL`. Empty fails closed at the adapter, never with a default. */
    baseUrl: string;
}

export function buildTenantAiService(args: BuildAiServiceArgs): AIService {
    const { db, profile, tenantId, tenantKey, managedKey, model, plan } = args;

    // THE one resolution, and now the only one: the ADAPTER it builds is the
    // adapter the service calls. Until this line handed the instance on, the
    // resolver picked a provider and the service quietly built a second one
    // from the workspace key alone — so the managed path had no credential
    // behind it and every endpoint was hard-wired to one vendor.
    const resolved = resolveAi({
        profile,
        aiEnabled: args.aiEnabled,
        tenantKey,
        tenantBaseUrl: args.tenantBaseUrl,
        tenantModel: args.tenantModel,
        managedKey,
        // Entitlement is a property of the PLAN, answered here and nowhere
        // else. The resolver receives a boolean and never learns what grants
        // it, which is what keeps packaging out of the resolver.
        managedEntitled: isPaidPlan(plan),
        underCap: true,
        model,
        defaultBaseUrl: args.baseUrl,
        // Tags for gateway logs. The adapter emits them only when the endpoint
        // really is the gateway, so a workspace's own provider never receives
        // them. No user id: this is built per request, not per actor, and a
        // field that would sometimes be wrong is worse than one that is absent.
        ...(tenantId ? { gatewayMetadata: { tenant_id: tenantId } } : {}),
    });

    // A refusal is tagged 'byo' for METERING only. An unresolvable call never
    // reaches a provider, so nothing is spent either way; the defensive choice
    // is the metric that is the workspace's own bill rather than the
    // deployment's. The refusal REASON does not travel here because a usage
    // metric has nobody to show it to — the service refuses at the call, where
    // there is somebody reading.
    const source = isRefusal(resolved) ? 'byo' : resolved.source;

    return new AIService(
        db,
        // Still the workspace's own bound key, and still only for the two
        // questions this service asks of it: whether to show the `[DEV]`
        // placeholders, and whether a key exists at all. It is no longer the
        // credential a call runs on — that lives inside the adapter below.
        tenantKey ?? '',
        profile.aiDevMockFallback ? 'standalone' : 'saas',
        model,
        buildAiMeter({ db, tenantId, source }),
        { source, tenantKeyAttested: args.tenantKeyAttested },
        buildAiProvenanceSink({ db, tenantId, source, model }),
        buildAiQuotaPreflight({ guard: args.quotaGuard, tenantId, source, plan }),
        isRefusal(resolved) ? undefined : resolved.provider,
    );
}
