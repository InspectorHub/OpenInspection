/**
 * The deployment flags must survive the branding KV cache.
 *
 * `brandingMiddleware` writes a DELIBERATELY REDUCED object into KV: the
 * comment at the shaping step says isSaas / portalBaseUrl / tenantStatus are
 * "intentionally NOT cached because they depend on the deployment profile
 * rather than on per-tenant config", so a tenant moving between standalone and
 * shared picks up the new value without waiting for the 3600s TTL.
 *
 * That reasoning is right and the cache-hit path did not implement it: it
 * returned the parsed blob verbatim, flags absent. Since the entry is warm for
 * an hour at a time, the STEADY STATE was branding with no flags at all, and
 * `session-context.ts` reports `isSaas: branding?.isSaas || false` -- so the
 * "Switch workspace" sidebar entry, which is gated on exactly that, was dark
 * for every request that hit a warm cache.
 *
 * Nothing tested this middleware before, in either direction. That is the
 * reason it held: the D1 path is correct, and the D1 path is the one a
 * cold-start reading of the file walks through.
 *
 * ⚠️ WHICH DEPLOYMENT THIS REPRESENTS. `runBranding` hands the middleware a
 * `tenantId` that is already set. In the real chain that happens in STANDALONE
 * (tenantRouter resolves the fixed tenant) and on the PUBLIC slug prefixes
 * (/book/, /report/, /portal/, …) — not on a saas authenticated /api/* request,
 * where jwtAuthMiddleware sets tenantId at server/index.ts:257, seven lines
 * AFTER this middleware is mounted at :250, so it early-returns instead. The
 * `mode: 'saas'` below is therefore only exercising the flag values, not a
 * request shape saas produces; see the note on that early return in
 * branding.ts. Do not read these cases as covering the saas dashboard.
 *
 * Every case below asserts a flag AND a cached per-tenant field, because
 * "the flags are present" also passes on an object that ignored the cache.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createTestDb, setupSchema } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import { brandingMiddleware } from '../../../server/lib/middleware/branding';
import { tenantConfigs, tenants } from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = 'tenant-branding';
const PORTAL = 'https://portal.example';

/** The exact reduced shape the middleware itself puts in KV -- no flags. */
const CACHED_WITHOUT_FLAGS = JSON.stringify({
    companyName: 'Cached Co',
    primaryColor: '#123456',
    logoUrl: null,
    supportEmail: 'cached@example.com',
    billingUrl: '/settings',
    defaultProfileId: 'signature',
});

let binding: D1Database;
let kv: Map<string, string>;

function fakeKv(store: Map<string, string>) {
    return {
        get: async (k: string) => store.get(k) ?? null,
        put: async (k: string, v: string) => { store.set(k, v); },
    } as unknown as KVNamespace;
}

/** Drives the real middleware and hands back whatever it set on the context. */
async function runBranding(opts: { tenantId?: string | null; tenantStatus?: string } = {}) {
    const app = new Hono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('profile', { mode: 'saas', loginRedirectBase: PORTAL } as never);
        if (opts.tenantId !== null) c.set('tenantId', opts.tenantId ?? TENANT);
        c.set('tenantStatus', (opts.tenantStatus ?? 'active') as never);
        await next();
    });
    app.use('*', brandingMiddleware);
    app.get('/probe', (c) => c.json(c.get('branding')));

    const res = await app.fetch(new Request('http://x/probe'), {
        DB: binding,
        TENANT_CACHE: fakeKv(kv),
        APP_NAME: 'Fallback Name',
        PRIMARY_COLOR: '#000000',
        SENDER_EMAIL: 'fallback@example.com',
    } as never);
    return await res.json() as Record<string, unknown>;
}

beforeEach(async () => {
    const fix = createTestDb();
    await setupSchema(fix.sqlite);
    await fix.db.insert(tenants).values({
        id: TENANT, slug: 'branding-co', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
    await fix.db.insert(tenantConfigs).values({
        tenantId: TENANT,
        companyName: 'DB Co',
        primaryColor: '#abcdef',
        supportEmail: 'db@example.com',
        updatedAt: new Date(),
    } as never);
    binding = toD1Binding(fix.sqlite);
    kv = new Map();
});

describe('branding deployment flags', () => {
    it('re-applies them on the KV-HIT path, where they are not cached', async () => {
        kv.set(`branding:${TENANT}`, CACHED_WITHOUT_FLAGS);
        const branding = await runBranding();

        // The cached value really was used -- otherwise this asserts nothing.
        expect(branding.companyName, 'served from the cache, not from D1').toBe('Cached Co');

        expect(branding.isSaas).toBe(true);
        expect(branding.portalBaseUrl).toBe(PORTAL);
        expect(branding.tenantStatus).toBe('active');
    });

    it('applies them on the D1 path too', async () => {
        // POSITIVE CONTROL for the case above: this path was always correct, so
        // a "fix" that only made the assertions pass by weakening them fails here.
        const branding = await runBranding();
        expect(branding.companyName, 'served from D1, not from the cache').toBe('DB Co');
        expect(branding.isSaas).toBe(true);
        expect(branding.portalBaseUrl).toBe(PORTAL);
    });

    it('lets the LIVE flag win over a stale one left in an old cache entry', async () => {
        // A blob written by an older build could carry the flags. The whole
        // reason they are excluded is that the deployment profile, not the
        // cache, is authoritative -- so the stale copy must not win.
        kv.set(`branding:${TENANT}`, JSON.stringify({
            ...JSON.parse(CACHED_WITHOUT_FLAGS),
            isSaas: false,
            portalBaseUrl: 'https://stale.example',
            tenantStatus: 'suspended',
        }));
        const branding = await runBranding();
        expect(branding.companyName).toBe('Cached Co');
        expect(branding.isSaas).toBe(true);
        expect(branding.portalBaseUrl).toBe(PORTAL);
        expect(branding.tenantStatus).toBe('active');
    });

    it('carries them on the no-tenant fallback', async () => {
        const branding = await runBranding({ tenantId: null });
        expect(branding.companyName).toBe('Fallback Name');
        expect(branding.isSaas).toBe(true);
        expect(branding.portalBaseUrl).toBe(PORTAL);
    });

    it('reports the tenant status the request resolved, not the cached one', async () => {
        kv.set(`branding:${TENANT}`, CACHED_WITHOUT_FLAGS);
        const branding = await runBranding({ tenantStatus: 'suspended' });
        expect(branding.tenantStatus).toBe('suspended');
    });
});
