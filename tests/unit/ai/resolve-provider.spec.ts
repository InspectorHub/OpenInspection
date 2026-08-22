import { describe, it, expect } from 'vitest';
import { resolveAi, isRefusal } from '../../../server/lib/ai/resolve-provider';
import { AI_REFUSAL_REASON } from '../../../server/lib/ai/refusal-reason';
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
    // `aiEnabled` is required now: a caller must answer whether the workspace
    // switched AI off rather than inheriting "on" by omission. These cases are
    // all about the OTHER rules, so it is on throughout.
    const base = {
        managedKey: 'platform-key',
        model: 'a-model',
        aiEnabled: true,
        defaultBaseUrl: 'https://api.example.com/v1',
    };

    it('prefers the tenant own key', () => {
        const r = resolveAi({ ...base, profile: SAAS, tenantKey: 'k', managedEntitled: true, underCap: true });
        expect(r).toMatchObject({ source: 'byo' });
    });

    it('prefers the tenant own key even when managed is fully available', () => {
        // BYOK is never silently overridden: a tenant who configured a key
        // keeps spending on it, and the platform never takes over the bill.
        const r = resolveAi({ ...base, profile: SAAS, tenantKey: 'k', managedEntitled: true, underCap: true });
        expect(isRefusal(r) ? null : r.source).toBe('byo');
    });

    it('uses managed when the tenant has no key, is entitled, and is under cap', () => {
        const r = resolveAi({ ...base, profile: SAAS, tenantKey: null, managedEntitled: true, underCap: true });
        expect(r).toMatchObject({ source: 'managed' });
    });

    it('refuses — feature OFF — when over cap', () => {
        // Not "degraded", not "silently English": the caller already handles the
        // not-configured shape, and reusing it means one failure path, not two.
        // The refusal now NAMES itself, so the person who can top the allowance
        // up is not sent to the settings page instead.
        const r = resolveAi({ ...base, profile: SAAS, tenantKey: null, managedEntitled: true, underCap: false });
        expect(isRefusal(r) && r.refused).toBe(AI_REFUSAL_REASON.OVER_CAP);
    });

    it('refuses when the tenant is not entitled to managed', () => {
        const r = resolveAi({ ...base, profile: SAAS, tenantKey: null, managedEntitled: false, underCap: true });
        expect(isRefusal(r) && r.refused).toBe(AI_REFUSAL_REASON.UNAVAILABLE_HERE);
    });

    it('never offers managed in standalone', () => {
        // Absent, not disabled: a self-hosted deploy has no platform to bill.
        const r = resolveAi({ ...base, profile: STANDALONE, tenantKey: null, managedEntitled: true, underCap: true });
        expect(isRefusal(r) && r.refused).toBe(AI_REFUSAL_REASON.UNAVAILABLE_HERE);
    });

    it('still resolves BYO in standalone — the profile check gates only managed', () => {
        // The standalone guard must not become "AI is off in standalone".
        const r = resolveAi({ ...base, profile: STANDALONE, tenantKey: 'k', managedEntitled: false, underCap: true });
        expect(r).toMatchObject({ source: 'byo' });
    });

    it('fails closed when the deployment has no managed key provisioned', () => {
        // An entitlement with nothing behind it is OFF, not a runtime credential
        // error surfacing halfway through a report.
        const r = resolveAi({ profile: SAAS, aiEnabled: true, tenantKey: null, managedKey: null, managedEntitled: true, underCap: true, model: 'a-model' });
        expect(isRefusal(r) && r.refused).toBe(AI_REFUSAL_REASON.PLATFORM_KEY_MISSING);
    });

    it('passes the configured model through and adds no default of its own', () => {
        // The resolver must not invent a model to paper over missing config;
        // the adapter fails closed on an empty one (see model-config.spec).
        const r = resolveAi({
            profile: SAAS, aiEnabled: true, tenantKey: 'k', managedEntitled: false,
            underCap: true, model: '', defaultBaseUrl: 'https://api.example.com/v1',
        });
        if (isRefusal(r)) throw new Error('unexpected refusal');
        expect(r.provider.id).toBe('api.example.com');
        return expect(r.provider.complete({ prompt: 'x' })).rejects.toThrow(/no AI model is configured/i);
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

/**
 * Every refusal names itself.
 *
 * The rule this suite exists for: a suite made only of "it refused" assertions
 * passes against a resolver that refuses everything. So every refusal case
 * below is paired with the same context minus the one refusing fact, asserted
 * to RESOLVE — and the two endpoint suites at the bottom are the positive
 * control for the whole file.
 */
describe('resolveAi — every refusal names itself, with a control beside it', () => {
    const base = {
        profile: SAAS_PROFILE,
        aiEnabled: true,
        tenantKey: null as string | null,
        managedKey: 'mk' as string | null,
        managedEntitled: true,
        underCap: true,
        policyAccepted: true,
        model: 'a-vendor/a-model',
        defaultBaseUrl: 'https://gateway.ai.cloudflare.com/v1/a/g/compat/',
    };

    /** The control: the unmodified context must resolve, or every negative
     *  assertion below is meaningless. */
    it('resolves managed on the untouched baseline', () => {
        expect(isRefusal(resolveAi(base))).toBe(false);
    });

    it('refuses with switched_off when the workspace turned AI off, even with a key', () => {
        const r = resolveAi({ ...base, aiEnabled: false, tenantKey: 'tk' });
        expect(isRefusal(r) && r.refused).toBe(AI_REFUSAL_REASON.SWITCHED_OFF);
        // Control: the same context with the switch on resolves.
        expect(isRefusal(resolveAi({ ...base, tenantKey: 'tk' }))).toBe(false);
    });

    it('checks the off switch FIRST, so it outranks every other refusal', () => {
        // A workspace that switched AI off and is also over cap must be told
        // the thing they did, not sent to a billing page they do not need.
        const r = resolveAi({ ...base, aiEnabled: false, underCap: false, managedEntitled: false });
        expect(isRefusal(r) && r.refused).toBe(AI_REFUSAL_REASON.SWITCHED_OFF);
    });

    it('refuses with unavailable_here where there is no managed path at all', () => {
        const r = resolveAi({ ...base, profile: STANDALONE_PROFILE });
        expect(isRefusal(r) && r.refused).toBe(AI_REFUSAL_REASON.UNAVAILABLE_HERE);
        // Control: the same deployment still resolves a workspace's OWN key.
        expect(isRefusal(resolveAi({ ...base, profile: STANDALONE_PROFILE, tenantKey: 'tk' }))).toBe(false);
    });

    it('refuses with unavailable_here when the workspace is not entitled', () => {
        const r = resolveAi({ ...base, managedEntitled: false });
        expect(isRefusal(r) && r.refused).toBe(AI_REFUSAL_REASON.UNAVAILABLE_HERE);
    });

    it('refuses with over_cap when the allowance is spent', () => {
        const r = resolveAi({ ...base, underCap: false });
        expect(isRefusal(r) && r.refused).toBe(AI_REFUSAL_REASON.OVER_CAP);
    });

    it('refuses with platform_key_missing — the operator\'s fault, never the workspace\'s', () => {
        const r = resolveAi({ ...base, managedKey: null });
        expect(isRefusal(r) && r.refused).toBe(AI_REFUSAL_REASON.PLATFORM_KEY_MISSING);
    });

    it('refuses with policy_not_accepted before spending a managed call', () => {
        const r = resolveAi({ ...base, policyAccepted: false });
        expect(isRefusal(r) && r.refused).toBe(AI_REFUSAL_REASON.POLICY_NOT_ACCEPTED);
    });

    it('treats an unstated policy acceptance as no obstacle', () => {
        // A deployment that does not track acceptance must not be refused by a
        // field it never sets. Only an explicit false refuses.
        const { policyAccepted: _drop, ...withoutField } = base;
        expect(isRefusal(resolveAi(withoutField))).toBe(false);
    });

    it('does not gate a workspace\'s own key on policy acceptance', () => {
        // The disclosure that acceptance covers is about the PLATFORM key. A
        // workspace on its own key has its own relationship with its own
        // provider, and gating it here would refuse a call this deployment is
        // not the one arranging.
        const r = resolveAi({ ...base, tenantKey: 'tk', policyAccepted: false });
        expect(isRefusal(r)).toBe(false);
    });
});

describe('resolveAi — which endpoint and model each path gets', () => {
    const base = {
        profile: SAAS_PROFILE,
        aiEnabled: true,
        tenantKey: null as string | null,
        managedKey: 'mk' as string | null,
        managedEntitled: true,
        underCap: true,
        model: 'a-vendor/a-model',
        defaultBaseUrl: 'https://gateway.ai.cloudflare.com/v1/a/g/compat/',
    };

    it('gives a workspace its own base URL and model', () => {
        const r = resolveAi({
            ...base, tenantKey: 'tk',
            tenantBaseUrl: 'https://api.example.com/openai/v1',
            tenantModel: 'their-model',
        });
        expect(isRefusal(r)).toBe(false);
        if (isRefusal(r)) return;
        expect(r.source).toBe('byo');
        expect(r.provider.id).toBe('api.example.com');
    });

    it('falls back to the deployment default when the workspace configured no endpoint', () => {
        const r = resolveAi({ ...base, tenantKey: 'tk' });
        if (isRefusal(r)) throw new Error('unexpected refusal');
        expect(r.source).toBe('byo');
        expect(r.provider.id).toBe('a-vendor');
    });

    it('gives managed the deployment endpoint and the deployment model', () => {
        const r = resolveAi(base);
        if (isRefusal(r)) throw new Error('unexpected refusal');
        expect(r.source).toBe('managed');
        expect(r.provider.id).toBe('a-vendor');
    });

    it('never lets a workspace endpoint reach the managed path', () => {
        // A workspace with no key of its own does not get to redirect calls
        // funded by the platform key to an endpoint of their choosing.
        const r = resolveAi({ ...base, tenantBaseUrl: 'https://elsewhere.example.com/v1', tenantModel: 'x/y' });
        if (isRefusal(r)) throw new Error('unexpected refusal');
        expect(r.source).toBe('managed');
        expect(r.provider.id).toBe('a-vendor');
    });

    it('adds no model of its own — an empty one still fails closed in the adapter', () => {
        const r = resolveAi({ ...base, tenantKey: 'tk', model: '' });
        if (isRefusal(r)) throw new Error('unexpected refusal');
        return expect(r.provider.complete({ prompt: 'x' })).rejects.toThrow(/no AI model is configured/i);
    });
});
