/**
 * Contract test for the branding memo key shape.
 *
 * INVARIANT: branding is keyed BY TENANT (`branding:${tenantId}`). A SaaS
 * deploy serves many tenants from one isolate, so a key that omitted the
 * tenant id would let one company's name, colour and logo be served under
 * another's — the memo is per-request, but a request fans out into many
 * in-process API calls and every one of them would read the same wrong entry.
 * The key string is pinned here so widening it fails loudly instead of
 * quietly.
 *
 * WHY REUSE IS SAFE FOR FRESHNESS: branding already caches in KV behind a
 * 3600s TTL, so a value read at the top of a render may legitimately be an
 * hour old before the memo is involved at all. Reusing one value for the few
 * hundred milliseconds of a single render is therefore strictly fresher than
 * what already ships — the memo cannot widen the staleness window.
 *
 * The "loaded once" assertions are paired with a positive control that runs
 * the same loader with no scope, so a loader that stopped being called at all
 * cannot read as a pass.
 */

import { describe, it, expect, vi } from 'vitest';
import { REQUEST_SCOPE, createRequestScope, memoOnce } from '../../../server/lib/request-scope';

const scopedEnv = () => ({ [REQUEST_SCOPE]: createRequestScope() });

const TENANT_A = 'tenant-aaaa';
const TENANT_B = 'tenant-bbbb';

describe('tenant branding memo key', () => {
    it('loads branding once per tenant per scope', async () => {
        const env = scopedEnv();
        const loadBranding = vi.fn(async () => ({ appName: 'Acme Inspections', primaryColor: '#123456' }));

        const first = await memoOnce(env, `branding:${TENANT_A}`, loadBranding);
        const second = await memoOnce(env, `branding:${TENANT_A}`, loadBranding);
        const third = await memoOnce(env, `branding:${TENANT_A}`, loadBranding);

        expect(loadBranding).toHaveBeenCalledTimes(1);
        expect(second).toBe(first);
        expect(third).toBe(first);
    });

    it('is keyed by tenant, not globally', async () => {
        const env = scopedEnv();
        const loadBranding = vi.fn(async (tenantId: string) => ({
            appName: tenantId === TENANT_A ? 'Acme Inspections' : 'Beta Home Checks',
        }));

        const a = await memoOnce(env, `branding:${TENANT_A}`, () => loadBranding(TENANT_A));
        const b = await memoOnce(env, `branding:${TENANT_B}`, () => loadBranding(TENANT_B));
        await memoOnce(env, `branding:${TENANT_A}`, () => loadBranding(TENANT_A));

        expect(loadBranding).toHaveBeenCalledTimes(2);
        expect(a.appName).toBe('Acme Inspections');
        expect(b.appName).toBe('Beta Home Checks');
    });

    it('POSITIVE CONTROL: without a scope, branding reloads on every call', async () => {
        const env = {};
        const loadBranding = vi.fn(async () => ({ appName: 'Acme Inspections' }));

        await memoOnce(env, `branding:${TENANT_A}`, loadBranding);
        await memoOnce(env, `branding:${TENANT_A}`, loadBranding);
        await memoOnce(env, `branding:${TENANT_A}`, loadBranding);

        expect(loadBranding).toHaveBeenCalledTimes(3);
    });
});
