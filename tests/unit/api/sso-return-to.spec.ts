/**
 * Integration test for GET /api/auth/sso — return_to WIRING.
 *
 * The pure validator is covered in tests/unit/mcp/safe-return-to.spec.ts.
 * This test exercises the actual route so a wrong Zod field name, wrong
 * argument order, or a broken fallback in auth.ts would be caught.
 *
 * Harness pattern mirrors repair-builder-routes-harness.ts:
 *  - vi.mock('drizzle-orm/d1') so the handler's drizzle(c.env.DB) returns a fake
 *    user-lookup chain.
 *  - vi.mock the jwt-keyring so signJwt returns a deterministic token (no real
 *    ES256 keys needed).
 *  - Provide a fake KV (TENANT_CACHE) seeded with the handoff code, plus
 *    c.env.DB and a stub keyringPromise via middleware.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../../server/lib/jwt-keyring', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/lib/jwt-keyring')>();
    return { ...actual, signJwt: vi.fn().mockResolvedValue('fake.jwt.token') };
});

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
// eslint-disable-next-line import/order
import coreAuthRoutes from '../../../server/api/auth';
import type { HonoConfig } from '../../../server/types/hono';

const USER = { id: 'user-1', tenantId: 'tenant-1', role: 'admin' };

/** Fake user-lookup chain: drizzle(DB).select().from().where().get() -> USER. */
function makeUserDb(user: unknown) {
    const chain = {
        select: () => chain,
        from:   () => chain,
        where:  () => ({ get: async () => user }),
    };
    return chain;
}

/** Minimal in-memory KV seeded with one handoff code. */
function makeKv(seed: Record<string, string>) {
    const store = new Map<string, string>(Object.entries(seed));
    return {
        get:    async (k: string) => store.get(k) ?? null,
        delete: async (k: string) => { store.delete(k); },
    };
}

function buildApp(opts: { user?: unknown; kvSeed?: Record<string, string> } = {}) {
    const { user = USER, kvSeed } = opts;
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(makeUserDb(user));

    const seed = kvSeed ?? {
        'sso:valid-code-123': JSON.stringify({ userId: USER.id, tenantId: USER.tenantId }),
    };

    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.env = { DB: {}, TENANT_CACHE: makeKv(seed) } as unknown as HonoConfig['Bindings'];
        c.set('keyringPromise', Promise.resolve({}) as unknown as HonoConfig['Variables']['keyringPromise']);
        await next();
    });
    app.route('/api/auth', coreAuthRoutes);
    return app;
}

describe('GET /api/auth/sso — return_to wiring', () => {
    it('honors a same-origin return_to after the cookie is set', async () => {
        const app = buildApp();
        const res = await app.request('/api/auth/sso?code=valid-code-123&return_to=/oauth/authorize?x=1');
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe('/oauth/authorize?x=1');
        // Cookie was set on the same response.
        expect(res.headers.get('set-cookie')).toContain('__Host-inspector_token');
    });

    it('falls back to /inspections for a cross-origin return_to (open-redirect guard)', async () => {
        const app = buildApp();
        const res = await app.request('/api/auth/sso?code=valid-code-123&return_to=https://evil.test/');
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe('/inspections');
    });

    it('falls back to /inspections for a protocol-relative return_to', async () => {
        const app = buildApp();
        const res = await app.request('/api/auth/sso?code=valid-code-123&return_to=//evil.test/path');
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe('/inspections');
    });

    it('redirects to /inspections (default) when return_to is absent', async () => {
        const app = buildApp();
        const res = await app.request('/api/auth/sso?code=valid-code-123');
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe('/inspections');
    });
});
