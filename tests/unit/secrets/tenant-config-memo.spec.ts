/**
 * Contract test for the tenant-config memo key shapes.
 *
 * INVARIANT 1 — one decryption per tenant per request, shared across call
 * sites that do not know about each other. `server/lib/middleware/
 * integration-secrets.ts` and the email config loader (`loadTenantEmailConfig`
 * in `server/lib/email/build-email-service.ts`) both bottom out in the same
 * `loadTenantSecrets` from `server/lib/secrets-cache.ts`. Neither can see the
 * other, so the ONLY thing that makes them share work is agreeing on the key
 * string `secrets:${tenantId}`. That agreement is what this file pins: the
 * two call sites must land on one entry and receive the same object.
 *
 * INVARIANT 2 — `email-cfg:${tenantId}` is a SEPARATE key from
 * `secrets:${tenantId}`, because the two return different shapes: the raw
 * bundle is `Record<string, string> | null`, while the email loader returns a
 * `LoadedEmailConfig` (secrets plus resolved sender/provider fields). Collapsing
 * them onto one key would hand one caller the other's shape — a type error at
 * best and a wrong sender at worst.
 *
 * INVARIANT 3 — the plan lookup is likewise keyed per tenant
 * (`plan:${tenantId}`), so an entitlement answer can never cross tenants.
 *
 * Decryption is the expensive one of these: it is a KDF plus an AES-GCM open
 * per call, repeated for every in-process API call a render fans out into.
 * Every "runs once" assertion below is paired with a positive control that runs
 * the same factory WITHOUT a scope, so a factory that stopped being invoked at
 * all cannot be mistaken for a successful memo.
 */

import { describe, it, expect, vi } from 'vitest';
import { REQUEST_SCOPE, createRequestScope, memoOnce } from '../../../server/lib/request-scope';

const scopedEnv = () => ({ [REQUEST_SCOPE]: createRequestScope() });

const TENANT_A = 'tenant-aaaa';
const TENANT_B = 'tenant-bbbb';

describe('tenant secrets and config memo keys', () => {
    it('shares one decrypted bundle across two call sites that do not know about each other', async () => {
        const env = scopedEnv();
        const decrypted = { RESEND_API_KEY: 're_test', QBO_CLIENT_ID: 'qbo_test' };
        const loadTenantSecrets = vi.fn(async () => decrypted);

        // Call site 1: the integration-secrets middleware.
        const fromIntegrations = await memoOnce(env, `secrets:${TENANT_A}`, loadTenantSecrets);
        // Call site 2: the email config loader, reached independently.
        const fromEmail = await memoOnce(env, `secrets:${TENANT_A}`, loadTenantSecrets);

        expect(loadTenantSecrets).toHaveBeenCalledTimes(1);
        expect(fromIntegrations).toBe(fromEmail);
        expect(fromIntegrations).toBe(decrypted);
    });

    it('keeps tenants apart in the secrets key', async () => {
        const env = scopedEnv();
        const loadTenantSecrets = vi.fn(async (tenantId: string) => ({
            RESEND_API_KEY: tenantId === TENANT_A ? 're_a' : 're_b',
        }));

        const a = await memoOnce(env, `secrets:${TENANT_A}`, () => loadTenantSecrets(TENANT_A));
        const b = await memoOnce(env, `secrets:${TENANT_B}`, () => loadTenantSecrets(TENANT_B));
        await memoOnce(env, `secrets:${TENANT_A}`, () => loadTenantSecrets(TENANT_A));

        expect(loadTenantSecrets).toHaveBeenCalledTimes(2);
        expect(a.RESEND_API_KEY).toBe('re_a');
        expect(b.RESEND_API_KEY).toBe('re_b');
    });

    it('keeps email-cfg on its own key because it returns a different shape', async () => {
        const env = scopedEnv();
        // Raw bundle: Record<string, string> | null.
        const loadTenantSecrets = vi.fn(async () => ({ RESEND_API_KEY: 're_test' }));
        // LoadedEmailConfig: secrets plus the resolved sender/provider fields.
        const loadTenantEmailConfig = vi.fn(async () => ({
            provider: 'resend',
            fromEmail: 'reports@example.test',
            dbSecrets: { resendApiKey: 're_test' },
        }));

        const secrets = await memoOnce(env, `secrets:${TENANT_A}`, loadTenantSecrets);
        const emailCfg = await memoOnce(env, `email-cfg:${TENANT_A}`, loadTenantEmailConfig);
        // Re-reads of both keys stay on their own entries.
        await memoOnce(env, `secrets:${TENANT_A}`, loadTenantSecrets);
        await memoOnce(env, `email-cfg:${TENANT_A}`, loadTenantEmailConfig);

        expect(loadTenantSecrets).toHaveBeenCalledTimes(1);
        expect(loadTenantEmailConfig).toHaveBeenCalledTimes(1);
        expect(secrets).not.toBe(emailCfg);
        expect(emailCfg.fromEmail).toBe('reports@example.test');
    });

    it('reads the plan once per tenant per scope', async () => {
        const env = scopedEnv();
        const loadPlan = vi.fn(async (tenantId: string) => ({
            plan: tenantId === TENANT_A ? 'pro' : 'free',
        }));

        const first = await memoOnce(env, `plan:${TENANT_A}`, () => loadPlan(TENANT_A));
        const second = await memoOnce(env, `plan:${TENANT_A}`, () => loadPlan(TENANT_A));
        const other = await memoOnce(env, `plan:${TENANT_B}`, () => loadPlan(TENANT_B));

        expect(loadPlan).toHaveBeenCalledTimes(2);
        expect(second).toBe(first);
        expect(first.plan).toBe('pro');
        expect(other.plan).toBe('free');
    });

    it('POSITIVE CONTROL: without a scope, every call decrypts and re-reads', async () => {
        const env = {};
        const loadTenantSecrets = vi.fn(async () => ({ RESEND_API_KEY: 're_test' }));
        const loadTenantEmailConfig = vi.fn(async () => ({ provider: 'resend' }));
        const loadPlan = vi.fn(async () => ({ plan: 'pro' }));

        await memoOnce(env, `secrets:${TENANT_A}`, loadTenantSecrets);
        await memoOnce(env, `secrets:${TENANT_A}`, loadTenantSecrets);
        await memoOnce(env, `secrets:${TENANT_A}`, loadTenantSecrets);
        await memoOnce(env, `email-cfg:${TENANT_A}`, loadTenantEmailConfig);
        await memoOnce(env, `email-cfg:${TENANT_A}`, loadTenantEmailConfig);
        await memoOnce(env, `plan:${TENANT_A}`, loadPlan);
        await memoOnce(env, `plan:${TENANT_A}`, loadPlan);

        expect(loadTenantSecrets).toHaveBeenCalledTimes(3);
        expect(loadTenantEmailConfig).toHaveBeenCalledTimes(2);
        expect(loadPlan).toHaveBeenCalledTimes(2);
    });
});
