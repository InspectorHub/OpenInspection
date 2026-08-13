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
import { buildAiMeter, buildAiQuotaPreflight, resolveRuntimeAiSource } from './metering';
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
}

export function buildTenantAiService(args: BuildAiServiceArgs): AIService {
    const { db, profile, tenantId, tenantKey, managedKey, model, plan } = args;

    // THE one resolution. `null` means the feature is off for this tenant; it
    // is tagged 'byo' downstream because an unresolvable call never reaches a
    // provider, and the defensive choice is the metric that is the tenant's
    // own bill rather than the deployment's.
    const source = resolveRuntimeAiSource({ profile, tenantKey, managedKey, model, plan }) ?? 'byo';

    return new AIService(
        db,
        // The tenant's own bound key — always wins, and still the ONLY
        // credential reaching the service. An entitled tenant resolves
        // `managed` above and every managed output class is refused by the
        // capability gate, so no managed call reaches a provider; handing the
        // service the resolved provider is what the FIRST such release needs.
        tenantKey ?? '',
        profile.aiDevMockFallback ? 'standalone' : 'saas',
        model,
        buildAiMeter({ db, tenantId, source }),
        { source, tenantKeyAttested: args.tenantKeyAttested },
        buildAiProvenanceSink({ db, tenantId, source, model }),
        buildAiQuotaPreflight({ guard: args.quotaGuard, tenantId, source, plan }),
    );
}
