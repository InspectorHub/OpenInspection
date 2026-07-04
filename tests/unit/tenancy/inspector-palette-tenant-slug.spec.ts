import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

/**
 * SaaS regression: authenticated API requests resolve the tenant from the
 * JWT, so `requestedTenantSlug` is never set and branding.tenantSlug came
 * out null (webhook URL / booking URL rendered slug-less on settings pages).
 * The middleware must fall back to a tenants.slug lookup by tenantId.
 */
const getQueue: unknown[] = [];
vi.mock('drizzle-orm/d1', () => ({
    drizzle: () => ({
        select: () => ({
            from: () => ({
                where: () => ({ get: async () => getQueue.shift() ?? null }),
            }),
        }),
    }),
}));

import { inspectorPaletteMiddleware } from '../../../server/lib/middleware/inspector-palette';
import type { HonoConfig } from '../../../server/types/hono';

function makeApp(opts: {
    requestedTenantSlug?: string;
    kvStore?: Map<string, string>;
}) {
    const kvStore = opts.kvStore ?? new Map<string, string>();
    const kv = {
        get: vi.fn(async (k: string) => kvStore.get(k) ?? null),
        put: vi.fn(async (k: string, v: string) => { kvStore.set(k, v); }),
    };
    const app = new Hono<HonoConfig>();
    app.use('*', async (c, next) => {
        (c as { env: Record<string, unknown> }).env = { DB: {}, TENANT_CACHE: kv };
        c.set('user', { sub: 'u1', role: 'owner', tenantId: 't1' } as never);
        c.set('tenantId', 't1' as never);
        c.set('branding', { companyName: 'X', primaryColor: '#fff' } as never);
        if (opts.requestedTenantSlug) c.set('requestedTenantSlug', opts.requestedTenantSlug as never);
        Object.defineProperty(c, 'executionCtx', {
            value: { waitUntil: (p: Promise<unknown>) => { void p; } },
            configurable: true,
        });
        await next();
    });
    app.use('*', inspectorPaletteMiddleware);
    app.get('/', (c) => c.json({ tenantSlug: (c.get('branding') as { tenantSlug?: string | null })?.tenantSlug ?? null }));
    return { app, kv, kvStore };
}

beforeEach(() => { getQueue.length = 0; });

describe('inspector-palette tenantSlug fallback', () => {
    it('uses requestedTenantSlug when present (standalone/public path)', async () => {
        getQueue.push({ slug: 'inspector-bob' }); // user-slug lookup
        const { app } = makeApp({ requestedTenantSlug: 'acme' });
        const res = await app.request('/');
        expect(((await res.json()) as { tenantSlug: string | null }).tenantSlug).toBe('acme');
    });

    it('falls back to tenants.slug lookup by tenantId when unset (saas JWT path)', async () => {
        getQueue.push({ slug: 'inspector-bob' }); // user-slug lookup (first query)
        getQueue.push({ slug: 'acme-saas' });     // tenants.slug lookup (second query)
        const { app } = makeApp({});
        const res = await app.request('/');
        expect(((await res.json()) as { tenantSlug: string | null }).tenantSlug).toBe('acme-saas');
    });

    it('serves the fallback from KV when cached (no second D1 query)', async () => {
        getQueue.push({ slug: 'inspector-bob' });
        const kvStore = new Map<string, string>([['tslug:t1', 'cached-slug']]);
        const { app } = makeApp({ kvStore });
        const res = await app.request('/');
        expect(((await res.json()) as { tenantSlug: string | null }).tenantSlug).toBe('cached-slug');
        expect(getQueue.length).toBe(0); // only the user-slug query consumed
    });

    it('stays null when the tenant row has no slug', async () => {
        getQueue.push({ slug: 'inspector-bob' });
        getQueue.push(null); // tenant lookup misses
        const { app } = makeApp({});
        const res = await app.request('/');
        expect(((await res.json()) as { tenantSlug: string | null }).tenantSlug).toBeNull();
    });
});
