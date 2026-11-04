import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

/**
 * SaaS regression: authenticated API requests resolve the tenant from the
 * JWT, so `requestedTenantSlug` is never set and branding.tenantSlug came
 * out null (webhook URL / booking URL rendered slug-less on settings pages).
 * The middleware must fall back to a tenants.slug lookup by tenantId.
 */

import { inspectorPaletteMiddleware } from '../../../server/lib/middleware/inspector-palette';
import type { HonoConfig } from '../../../server/types/hono';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { createTestDb } from '../db';
import { d1For } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';

/** Settled at teardown by the helper -- `void p` used to detach the promise,
 *  which is how a run with every test passing could still exit non-zero. */
const EXEC_CTX = makeExecutionContext().ctx;

function makeApp(opts: {
    requestedTenantSlug?: string;
    kvStore?: Map<string, string>;
    /** The slug of company t1 in the database; absent means there is no such company row. */
    tenantSlug?: string;
}) {
    // The user's own slug is in the database; the company row is there only when the case wants one.
    const { db, sqlite } = createTestDb();
    sqlite.pragma('foreign_keys = OFF');
    if (opts.tenantSlug) {
        db.insert(schema.tenants).values({
            id: 't1', slug: opts.tenantSlug, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as never).run();
    }
    db.insert(schema.users).values({
        id: 'u1', tenantId: 't1', email: 'bob@example.test', passwordHash: 'x', role: 'owner', slug: 'inspector-bob', createdAt: new Date(),
    } as never).run();
    const real = d1For(sqlite);
    const reads = { tenants: 0 };
    const binding = {
        prepare: (sql: string) => {
            if (/from "tenants"/i.test(sql)) reads.tenants += 1;
            return real.prepare(sql);
        },
        batch: (list: never) => (real.batch as (l: never) => unknown)(list),
    } as unknown as D1Database;
    const kvStore = opts.kvStore ?? new Map<string, string>();
    const kv = {
        get: vi.fn(async (k: string) => kvStore.get(k) ?? null),
        put: vi.fn(async (k: string, v: string) => { kvStore.set(k, v); }),
    };
    const app = new Hono<HonoConfig>();
    app.use('*', async (c, next) => {
        Object.defineProperty(c, 'env', { value: { DB: binding, TENANT_CACHE: kv }, configurable: true });
        c.set('user', { sub: 'u1', role: 'owner', tenantId: 't1' } as never);
        c.set('tenantId', 't1' as never);
        c.set('branding', { companyName: 'X', primaryColor: '#fff' } as never);
        if (opts.requestedTenantSlug) c.set('requestedTenantSlug', opts.requestedTenantSlug as never);
        Object.defineProperty(c, 'executionCtx', {
            // From module scope, not built here: this runs per request, so a
            // fresh context each time would register a teardown hook from
            // inside a test and settle nothing. One context, settled once.
            value: EXEC_CTX,
            configurable: true,
        });
        await next();
    });
    app.use('*', inspectorPaletteMiddleware);
    app.get('/', (c) => c.json({ tenantSlug: (c.get('branding') as { tenantSlug?: string | null })?.tenantSlug ?? null }));
    return { app, kv, kvStore, reads };
}


describe('inspector-palette tenantSlug fallback', () => {
    it('uses requestedTenantSlug when present (standalone/public path)', async () => {
        const { app } = makeApp({ requestedTenantSlug: 'acme', tenantSlug: 'acme-saas' });
        const res = await app.request('/');
        expect(((await res.json()) as { tenantSlug: string | null }).tenantSlug).toBe('acme');
    });

    it('falls back to tenants.slug lookup by tenantId when unset (saas JWT path)', async () => {
        const { app } = makeApp({ tenantSlug: 'acme-saas' });
        const res = await app.request('/');
        expect(((await res.json()) as { tenantSlug: string | null }).tenantSlug).toBe('acme-saas');
    });

    it('serves the fallback from KV when cached (no second D1 query)', async () => {
        const kvStore = new Map<string, string>([['tslug:t1', 'cached-slug']]);
        const { app, reads } = makeApp({ kvStore, tenantSlug: 'acme-saas' });
        const res = await app.request('/');
        expect(((await res.json()) as { tenantSlug: string | null }).tenantSlug).toBe('cached-slug');
        expect(reads.tenants).toBe(0); // the company row was never read: the cache answered
    });

    it('stays null when the tenant row has no slug', async () => {
        const { app } = makeApp({}); // the company lookup finds no row
        const res = await app.request('/');
        expect(((await res.json()) as { tenantSlug: string | null }).tenantSlug).toBeNull();
    });
});
