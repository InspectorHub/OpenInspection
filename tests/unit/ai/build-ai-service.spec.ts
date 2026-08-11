import { describe, it, expect, vi } from 'vitest';
import { buildTenantAiService } from '../../../server/lib/ai/build-ai-service';
import { SAAS_PROFILE, STANDALONE_PROFILE } from '../../../server/lib/deployment-profile';
import type { AiQuotaPreflight } from '../../../server/lib/ai/metering';
import type { PlanQuotaGuard } from '../../../server/features/plan-quota/guard';
import type { TenantPlan } from '../../../server/features/plan-quota/policy';

/**
 * The CONSTRUCTION site of the AI enforcement chain.
 *
 * `checkAiQuota` spent its whole life written, tested, and reading a delivered
 * allowance while having zero production callers. Wiring it fixed that — and
 * moved the same failure one step outward, to the line that injects the
 * pre-flight into the service. Measured 2026-08-11: replacing that argument
 * with `undefined` left `tests/unit/usage/ai-quota.spec.ts` and
 * `tests/unit/ai/resolve-provider.spec.ts` at **39 passed**. Every existing case
 * builds an `AIService` by hand, so none of them can see the builder that
 * production actually goes through (`server/lib/middleware/di.ts`).
 *
 * These cases are the ones that go red when the injection disappears.
 *
 * They assert the wiring, not the runtime behaviour, and that is deliberate:
 * `callGemini` consults the capability gate BEFORE the pre-flight
 * (`services/ai.service.ts:194` vs `:208`), and that gate refuses every managed
 * output class until 08-07 Task 6 flips it. So no end-to-end call can reach the
 * pre-flight today. Reaching through `private quota` is the price of pinning a
 * link whose behaviour is deliberately unreachable; when the gate opens, prefer
 * a behavioural case and delete this reach-through.
 */

const PAID: TenantPlan = { tier: 'pro', status: 'active' };
const FREE: TenantPlan = { tier: 'free', status: 'active' };

/** The runtime shape of the private field, named once so a rename fails here
 *  rather than silently turning every assertion below into `undefined`. */
function injectedQuota(svc: unknown): AiQuotaPreflight | undefined {
    return (svc as { quota?: AiQuotaPreflight }).quota;
}

function build(over: Partial<Parameters<typeof buildTenantAiService>[0]> = {}) {
    const guard = { checkAiQuota: vi.fn(async () => {}) };
    const svc = buildTenantAiService({
        db: {} as D1Database,
        profile: SAAS_PROFILE,
        tenantId: 't-1',
        tenantKey: null,
        managedKey: 'platform-key',
        model: 'a-model',
        plan: PAID,
        tenantKeyAttested: false,
        quotaGuard: guard as unknown as PlanQuotaGuard,
        ...over,
    });
    return { svc, guard };
}

describe('buildTenantAiService injects the quota pre-flight', () => {
    it('gives a managed, paid tenant a pre-flight that reaches the guard', async () => {
        // The whole chain in one assertion: the builder injected something, and
        // the something it injected calls checkAiQuota with this tenant, this
        // tier, and the metric that matches the usage kind.
        const { svc, guard } = build();
        const quota = injectedQuota(svc);
        expect(quota).toBeDefined();

        await quota!.preflight('assist');
        expect(guard.checkAiQuota).toHaveBeenCalledWith('t-1', 'pro', 'ai_assist');

        await quota!.preflight('translate');
        expect(guard.checkAiQuota).toHaveBeenCalledWith('t-1', 'pro', 'ai_translate');
    });

    it('injects nothing for a tenant on its own key', () => {
        // BYO spends the tenant's own money. A platform allowance has no claim
        // on it, so there is nothing to enforce — not a cap of zero.
        expect(injectedQuota(build({ tenantKey: 'tenant-own-key' }).svc)).toBeUndefined();
    });

    it('injects nothing in standalone', () => {
        // The check that protects self-hosters: no platform, no allowance, and
        // so no quota errors pointing at a billing portal they do not have.
        expect(injectedQuota(build({ profile: STANDALONE_PROFILE }).svc)).toBeUndefined();
    });

    it('injects nothing for a tenant with no paid plan', () => {
        expect(injectedQuota(build({ plan: FREE }).svc)).toBeUndefined();
        expect(injectedQuota(build({ plan: null }).svc)).toBeUndefined();
    });

    it('injects nothing when the deployment never provisioned a managed key', () => {
        // Fail closed: an entitlement with no key behind it is the feature OFF,
        // so there is no managed call to meter and nothing to cap.
        expect(injectedQuota(build({ managedKey: null }).svc)).toBeUndefined();
    });

    it('injects nothing when the deployment has no quota guard at all', () => {
        expect(injectedQuota(build({ quotaGuard: undefined }).svc)).toBeUndefined();
    });

    it('covers both answers, so a builder that always returned undefined would fail', () => {
        // Guards the guard. Every case above but the first asserts ABSENCE; if
        // the reach-through ever stopped resolving the field, they would all
        // still pass and only this pairing would notice.
        expect(injectedQuota(build().svc)).toBeDefined();
        expect(injectedQuota(build({ tenantKey: 'k' }).svc)).toBeUndefined();
    });
});
