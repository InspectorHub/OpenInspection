/**
 * Contract test for the slug memo key shapes.
 *
 * INVARIANT: a user slug is keyed by tenant AND user
 * (`user-slug:${tenantId}:${userId}`); a tenant slug is keyed by tenant alone
 * (`tenant-slug:${tenantId}`). The user key needs both halves because slugs
 * are only unique within a tenant, and because several inspectors from the
 * same company can be resolved side by side inside one render — dropping the
 * user half would hand every inspector on the page the first one's slug and
 * palette. The two keys are also deliberately distinct namespaces: a tenant
 * slug and a user slug are different values and must never collide on one
 * entry.
 *
 * WHY REUSE IS SAFE FOR FRESHNESS: both slugs already cache in KV behind a
 * 300s TTL, so a value can legitimately be five minutes old before the memo
 * exists at all. Sharing one resolution across a single render is strictly
 * fresher than the caching that already ships.
 *
 * Each "resolved once" assertion is paired with a positive control that runs
 * the resolver without a scope, so a resolver that stopped running altogether
 * cannot pass as memoisation.
 */

import { describe, it, expect, vi } from 'vitest';
import { REQUEST_SCOPE, createRequestScope, memoOnce } from '../../../server/lib/request-scope';

const scopedEnv = () => ({ [REQUEST_SCOPE]: createRequestScope() });

const TENANT_A = 'tenant-aaaa';
const USER_A = 'user-aaaa';
const USER_B = 'user-bbbb';

describe('slug memo keys', () => {
    it('resolves a user slug once per user and tenant per scope', async () => {
        const env = scopedEnv();
        const resolveUserSlug = vi.fn(async () => 'jane-doe');

        const first = await memoOnce(env, `user-slug:${TENANT_A}:${USER_A}`, resolveUserSlug);
        const second = await memoOnce(env, `user-slug:${TENANT_A}:${USER_A}`, resolveUserSlug);

        expect(resolveUserSlug).toHaveBeenCalledTimes(1);
        expect(second).toBe(first);
    });

    it('does not share a slug between two users in the same tenant', async () => {
        const env = scopedEnv();
        const resolveUserSlug = vi.fn(async (userId: string) => (userId === USER_A ? 'jane-doe' : 'sam-lee'));

        const a = await memoOnce(env, `user-slug:${TENANT_A}:${USER_A}`, () => resolveUserSlug(USER_A));
        const b = await memoOnce(env, `user-slug:${TENANT_A}:${USER_B}`, () => resolveUserSlug(USER_B));
        await memoOnce(env, `user-slug:${TENANT_A}:${USER_A}`, () => resolveUserSlug(USER_A));

        expect(resolveUserSlug).toHaveBeenCalledTimes(2);
        expect(a).toBe('jane-doe');
        expect(b).toBe('sam-lee');
    });

    it('resolves a tenant slug once per tenant per scope', async () => {
        const env = scopedEnv();
        const resolveTenantSlug = vi.fn(async () => 'acme-inspect');

        await memoOnce(env, `tenant-slug:${TENANT_A}`, resolveTenantSlug);
        await memoOnce(env, `tenant-slug:${TENANT_A}`, resolveTenantSlug);
        await memoOnce(env, `tenant-slug:${TENANT_A}`, resolveTenantSlug);

        expect(resolveTenantSlug).toHaveBeenCalledTimes(1);
    });

    it('keeps the user-slug and tenant-slug keys independent of each other', async () => {
        const env = scopedEnv();
        const resolveUserSlug = vi.fn(async () => 'jane-doe');
        const resolveTenantSlug = vi.fn(async () => 'acme-inspect');

        const user = await memoOnce(env, `user-slug:${TENANT_A}:${USER_A}`, resolveUserSlug);
        const tenant = await memoOnce(env, `tenant-slug:${TENANT_A}`, resolveTenantSlug);

        expect(resolveUserSlug).toHaveBeenCalledTimes(1);
        expect(resolveTenantSlug).toHaveBeenCalledTimes(1);
        expect(user).toBe('jane-doe');
        expect(tenant).toBe('acme-inspect');
    });

    it('POSITIVE CONTROL: without a scope, both slugs re-resolve every time', async () => {
        const env = {};
        const resolveUserSlug = vi.fn(async () => 'jane-doe');
        const resolveTenantSlug = vi.fn(async () => 'acme-inspect');

        await memoOnce(env, `user-slug:${TENANT_A}:${USER_A}`, resolveUserSlug);
        await memoOnce(env, `user-slug:${TENANT_A}:${USER_A}`, resolveUserSlug);
        await memoOnce(env, `tenant-slug:${TENANT_A}`, resolveTenantSlug);
        await memoOnce(env, `tenant-slug:${TENANT_A}`, resolveTenantSlug);

        expect(resolveUserSlug).toHaveBeenCalledTimes(2);
        expect(resolveTenantSlug).toHaveBeenCalledTimes(2);
    });
});
