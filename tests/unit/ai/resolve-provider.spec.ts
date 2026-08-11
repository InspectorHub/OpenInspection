import { describe, it, expect } from 'vitest';
import { resolveAi } from '../../../server/lib/ai/resolve-provider';
import { resolveRuntimeAiSource } from '../../../server/lib/ai/metering';
import { RecordingAiProvider } from '../../../server/lib/ai/providers/recording';
import type { AiProvider } from '../../../server/lib/ai/provider';
import { SAAS_PROFILE, STANDALONE_PROFILE } from '../../../server/lib/deployment-profile';

/**
 * Credential-source resolution for AI calls.
 *
 * `resolveAi` owns one decision — which key an AI call runs on, or whether it
 * runs at all. Every branch below is a rule someone could plausibly "simplify"
 * away, so each is pinned by a test that fails loudly if it disappears.
 */
describe('resolveAi', () => {
    const SAAS = SAAS_PROFILE;
    const STANDALONE = STANDALONE_PROFILE;
    const base = { managedKey: 'platform-key', model: 'a-model' };

    it('prefers the tenant own key', () => {
        const r = resolveAi({ ...base, profile: SAAS, tenantKey: 'k', managedEntitled: true, underCap: true });
        expect(r).toMatchObject({ source: 'byo' });
    });

    it('prefers the tenant own key even when managed is fully available', () => {
        // BYOK is never silently overridden: a tenant who configured a key
        // keeps spending on it, and the platform never takes over the bill.
        const r = resolveAi({ ...base, profile: SAAS, tenantKey: 'k', managedEntitled: true, underCap: true });
        expect(r?.source).toBe('byo');
    });

    it('uses managed when the tenant has no key, is entitled, and is under cap', () => {
        const r = resolveAi({ ...base, profile: SAAS, tenantKey: null, managedEntitled: true, underCap: true });
        expect(r).toMatchObject({ source: 'managed' });
    });

    it('returns null — feature OFF — when over cap', () => {
        // Not "degraded", not "silently English": the caller already handles the
        // not-configured shape, and reusing it means one failure path, not two.
        expect(resolveAi({ ...base, profile: SAAS, tenantKey: null, managedEntitled: true, underCap: false })).toBeNull();
    });

    it('returns null when the tenant is not entitled to managed', () => {
        expect(resolveAi({ ...base, profile: SAAS, tenantKey: null, managedEntitled: false, underCap: true })).toBeNull();
    });

    it('never offers managed in standalone', () => {
        // Absent, not disabled: a self-hosted deploy has no platform to bill.
        expect(resolveAi({ ...base, profile: STANDALONE, tenantKey: null, managedEntitled: true, underCap: true })).toBeNull();
    });

    it('still resolves BYO in standalone — the profile check gates only managed', () => {
        // The standalone guard must not become "AI is off in standalone".
        const r = resolveAi({ ...base, profile: STANDALONE, tenantKey: 'k', managedEntitled: false, underCap: true });
        expect(r).toMatchObject({ source: 'byo' });
    });

    it('fails closed when the deployment has no managed key provisioned', () => {
        // An entitlement with nothing behind it is OFF, not a runtime credential
        // error surfacing halfway through a report.
        const r = resolveAi({ profile: SAAS, tenantKey: null, managedKey: null, managedEntitled: true, underCap: true, model: 'a-model' });
        expect(r).toBeNull();
    });

    it('passes the configured model through and adds no default of its own', () => {
        // The resolver must not invent a model to paper over missing config;
        // the adapter fails closed on an empty one (see model-config.spec).
        const r = resolveAi({ profile: SAAS, tenantKey: 'k', managedEntitled: false, underCap: true, model: '' });
        expect(r?.provider.id).toBe('gemini');
        return expect(r!.provider.complete({ prompt: 'x' })).rejects.toThrow(/no AI model is configured/i);
    });
});

/**
 * The paid-tier entitlement, at the ONE place it is decided.
 *
 * `resolveAi` takes `managedEntitled` as a boolean and never learns what grants
 * it — that is deliberate and unchanged. `resolveRuntimeAiSource` is the single
 * caller that answers the boolean, so it is the only place this can be tested
 * without inventing a second entitlement read. All four surfaces that ask
 * "whose key would this run on" go through it: the meter's tag, the capability
 * gate's source, the provenance row's mode, and the portal-facing provisioning
 * console.
 *
 * Both directions are asserted. A suite that only checked the refusal would
 * pass against an implementation that refuses everyone — which is precisely
 * what the hardcoded `managedEntitled: false` was.
 */
describe('resolveRuntimeAiSource — paid-tier entitlement', () => {
    const creds = { profile: SAAS_PROFILE, tenantKey: null, managedKey: 'platform-key', model: 'a-model' };

    it('a paying tenant with no key of their own resolves MANAGED', () => {
        expect(resolveRuntimeAiSource({ ...creds, plan: { tier: 'pro', status: 'active' } })).toBe('managed');
    });

    it('a free tenant resolves nothing, even with a platform key provisioned', () => {
        expect(resolveRuntimeAiSource({ ...creds, plan: { tier: 'free', status: 'active' } })).toBeNull();
    });

    it('a trialling tenant on a paid tier is not entitled — trialling is not paying', () => {
        expect(resolveRuntimeAiSource({ ...creds, plan: { tier: 'pro', status: 'trial' } })).toBeNull();
    });

    it('an unresolved plan is not an entitlement — fail closed, never fail open', () => {
        // Contexts that could not read the tenant's plan (a public path, a
        // failed lookup) must not inherit managed access by default.
        expect(resolveRuntimeAiSource({ ...creds, plan: null })).toBeNull();
    });

    it('BYOK still wins for a paying tenant — the platform never takes over the bill', () => {
        expect(resolveRuntimeAiSource({ ...creds, tenantKey: 'own-key', plan: { tier: 'pro', status: 'active' } })).toBe('byo');
    });

    it('standalone never resolves managed, whatever the plan row says', () => {
        expect(resolveRuntimeAiSource({
            ...creds, profile: STANDALONE_PROFILE, plan: { tier: 'enterprise', status: 'active' },
        })).toBeNull();
    });

    it('an entitled tenant on a deployment with no platform key resolves nothing', () => {
        // Production today. Entitlement is TRUE here and the answer is still
        // null, which is why wiring entitlement moves no production number
        // until AI_MANAGED_API_KEY is provisioned.
        expect(resolveRuntimeAiSource({
            ...creds, managedKey: null, plan: { tier: 'pro', status: 'active' },
        })).toBeNull();
    });
});

describe('AiProvider contract', () => {
    it('is satisfiable without any backend-specific concept', async () => {
        // The recording double implements the whole interface and mentions no
        // vendor shape. If this ever stops compiling, the contract has leaked
        // a backend detail and a second backend just became a rewrite.
        const provider: AiProvider = new RecordingAiProvider(['hello']);
        const out = await provider.complete({ prompt: 'ask', temperature: 0.1 });
        expect(out.text).toBe('hello');
        expect((provider as RecordingAiProvider).requests[0]).toMatchObject({ prompt: 'ask', temperature: 0.1 });
    });
});
