import { describe, it, expect } from 'vitest';
import { resolveAi } from '../../../server/lib/ai/resolve-provider';
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
