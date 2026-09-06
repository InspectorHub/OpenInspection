/**
 * The inspector-palette memo, asserted against the MIDDLEWARE rather than
 * against the key string.
 *
 * `palette-slug-memo.spec.ts` next door pins the two key SHAPES by calling
 * `memoOnce` directly, which means it would stay green if the calls were
 * deleted from `inspector-palette.ts`. This spec drives the real middleware and
 * counts the KV reads it performs.
 *
 * Nothing else covers this point. The D1 budget gate probes an UNAUTHENTICATED
 * request, and this middleware returns immediately when there is no user — so
 * an unwired memo here is invisible to every other check in the suite.
 *
 * Counting KV rather than D1 is deliberate: both slugs are cached in KV with a
 * 300s TTL, so on the hot path the D1 fallback never runs and wrapping only
 * that fallback would have left the repeated KV round trips in place. KV reads
 * are therefore the thing whose count actually has to drop.
 */
import { describe, it, expect } from 'vitest';
import { createRequestScope, REQUEST_SCOPE } from '../../../server/lib/request-scope';
import { inspectorPaletteMiddleware } from '../../../server/lib/middleware/inspector-palette';

const TENANT = 't1';
const USER = 'u1';

/** KV pre-warmed with both slugs, counting reads per key prefix. */
function countingCache(counts: { user: number; tenant: number }) {
    const store = new Map<string, string>([[`uslug:${USER}`, 'jane'], [`tslug:${TENANT}`, 'acme']]);
    return {
        get: async (k: string) => {
            if (k.startsWith('uslug:')) counts.user += 1;
            if (k.startsWith('tslug:')) counts.tenant += 1;
            return store.get(k) ?? null;
        },
        put: async (k: string, v: string) => { store.set(k, v); },
    } as unknown as KVNamespace;
}

async function pass(env: Record<string, unknown>) {
    const vars = new Map<string, unknown>([
        ['branding', { companyName: 'Acme', primaryColor: '#000', logoUrl: null, supportEmail: 'a@b.c', billingUrl: '/s' }],
        ['user', { sub: USER }],
        ['tenantId', TENANT],
    ]);
    const c = {
        env,
        req: { path: '/api/event-types', url: 'http://x/api/event-types', header: () => undefined },
        get: (k: string) => vars.get(k),
        set: (k: string, v: unknown) => vars.set(k, v),
        var: {},
    };
    await (inspectorPaletteMiddleware as unknown as (ctx: unknown, n: () => Promise<void>) => Promise<void>)(c, async () => {});
    return vars.get('branding') as Record<string, unknown>;
}

describe('inspector-palette memo wiring', () => {
    it('resolves each slug once across a shared scope', async () => {
        const counts = { user: 0, tenant: 0 };
        const env = { TENANT_CACHE: countingCache(counts), DB: {} as D1Database, [REQUEST_SCOPE]: createRequestScope() };
        const first = await pass(env);
        await pass(env);
        // The middleware really did its job — otherwise the counts below are
        // satisfied by a middleware that resolved nothing at all.
        expect(first.currentUserSlug, 'the user slug still reaches branding').toBe('jane');
        expect(first.tenantSlug, 'the tenant slug still reaches branding').toBe('acme');
        expect(counts.user, 'user slug read twice in one request').toBe(1);
        expect(counts.tenant, 'tenant slug read twice in one request').toBe(1);
    });

    // POSITIVE CONTROL
    it('re-resolves both every time when there is no scope', async () => {
        const counts = { user: 0, tenant: 0 };
        const env = { TENANT_CACHE: countingCache(counts), DB: {} as D1Database };
        await pass(env);
        await pass(env);
        expect(counts.user).toBe(2);
        expect(counts.tenant).toBe(2);
    });
});
