/**
 * Spec 3 Task 5b — tenant-null SSO handoff branch (agent JWT via /sso).
 *
 * Portal's Google-OIDC agent-mode callback (Task 5c) hands off `{ email }`
 * (NO tenantId) to POST /api/integration/sso-handoff, gets a `/sso?code=`
 * URL, and 302s the agent to it. This exercises BOTH halves end-to-end
 * against a shared in-memory KV so the handoff-issued code is actually
 * redeemable by the consumer:
 *
 *  - POST /api/integration/sso-handoff (server/portal/integration.routes.ts)
 *    agent branch: no tenantId in the body -> resolves the GLOBAL agent
 *    (findGlobalAgentByEmail) -> KV payload is { userId } only.
 *  - GET /api/auth/sso (server/api/auth.ts) tenant-null branch: KV payload
 *    with no tenantId -> re-verifies the agent AT REDEEM TIME
 *    (findGlobalAgentById) -> mints the agent JWT (no custom:tenantId) ->
 *    302 /agent-dashboard.
 *
 * Also re-asserts the EXISTING tenant handoff + tenant /sso consume path is
 * unchanged (regression coverage), and single-use replay protection.
 *
 * Harness mirrors tests/unit/integrations/integration-sync-quota.spec.ts
 * (real better-sqlite3 db behind a mocked drizzle-orm/d1 + signM2mHeader for
 * requireServiceBinding) and tests/unit/agent/magic-login.spec.ts (mocked
 * signJwt + in-memory KV stub) — here both apps share the SAME kv instance so
 * the handoff-issued code round-trips into the consumer.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const { signJwtMock } = vi.hoisted(() => ({
    signJwtMock: vi.fn(async (payload: Record<string, unknown>) => `fake.jwt.${JSON.stringify(payload)}`),
}));
vi.mock('../../../server/lib/jwt-keyring', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/lib/jwt-keyring')>();
    return { ...actual, signJwt: signJwtMock };
});

import integrationRoutes from '../../../server/portal/integration.routes';
import coreAuthRoutes from '../../../server/api/auth';
import { signM2mHeader, M2M_HEADER } from '../../../server/lib/m2m-auth';
import type { HonoConfig } from '../../../server/types/hono';

const FAKE_PEM = `-----BEGIN PRIVATE KEY-----\n${btoa('test-m2m-shared-key-material-0123456789')}\n-----END PRIVATE KEY-----`;

const AGENT_USER_ID = '00000000-0000-0000-0000-0000000000c1';
const AGENT_EMAIL = 'agent@example.com';
const TENANT_ID = '00000000-0000-0000-0000-0000000000a1';
const TENANT_USER_ID = '00000000-0000-0000-0000-0000000000d1';
const TENANT_USER_EMAIL = 'member@example.com';

/** Minimal in-memory KV — get/put/delete, shared across both apps. */
function makeKv() {
    const store = new Map<string, string>();
    return {
        get: async (k: string) => store.get(k) ?? null,
        put: async (k: string, v: string) => { store.set(k, v); },
        delete: async (k: string) => { store.delete(k); },
        store,
    };
}

describe('Tenant-null SSO handoff — agent JWT via /sso (Spec 3 Task 5b)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;
    let kv: ReturnType<typeof makeKv>;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        signJwtMock.mockClear();
        kv = makeKv();

        await db.insert(schema.tenants).values({
            id: TENANT_ID, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
    });

    afterEach(() => sqlite.close());

    function envFor() {
        return {
            DB: {}, TENANT_CACHE: kv,
            JWT_CURRENT_KID: 'v1', JWT_PRIVATE_KEY_V1: FAKE_PEM,
        } as Record<string, unknown>;
    }

    function buildHandoffApp() {
        const app = new OpenAPIHono<HonoConfig>();
        app.route('/api/integration', integrationRoutes);
        return app;
    }

    function buildConsumeApp() {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.env = envFor() as unknown as HonoConfig['Bindings'];
            c.set('keyringPromise', Promise.resolve({}) as unknown as HonoConfig['Variables']['keyringPromise']);
            await next();
        });
        app.route('/api/auth', coreAuthRoutes);
        return app;
    }

    async function seedGlobalAgent(id: string, email: string) {
        await db.insert(schema.users).values({
            id, tenantId: null, email, name: 'Agent Smith', role: 'agent',
            createdAt: new Date(), passwordHash: 'x',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
    }

    async function seedTenantUser(id: string, email: string) {
        await db.insert(schema.users).values({
            id, tenantId: TENANT_ID, email, name: 'Tenant Member', role: 'inspector',
            createdAt: new Date(), passwordHash: 'x',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
    }

    async function postHandoff(body: Record<string, unknown>) {
        const app = buildHandoffApp();
        const env = envFor();
        return app.request('/api/integration/sso-handoff', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                [M2M_HEADER]: await signM2mHeader(env as Record<string, string | undefined>),
            },
            body: JSON.stringify(body),
        }, env);
    }

    describe('POST /api/integration/sso-handoff — agent branch (no tenantId)', () => {
        it('mints a code for a global agent; KV payload has userId only, no tenantId', async () => {
            await seedGlobalAgent(AGENT_USER_ID, AGENT_EMAIL);

            const res = await postHandoff({ email: AGENT_EMAIL });
            expect(res.status).toBe(200);
            const body = await res.json() as { success: boolean; data: { code: string } };
            expect(body.success).toBe(true);

            const raw = await kv.get(`sso:${body.data.code}`);
            expect(raw).not.toBeNull();
            const parsed = JSON.parse(raw!);
            expect(parsed).toEqual({ userId: AGENT_USER_ID });
            expect(parsed).not.toHaveProperty('tenantId');
        });

        it('404s for an email with no global agent account', async () => {
            const res = await postHandoff({ email: 'nobody@example.com' });
            expect(res.status).toBe(404);
        });
    });

    describe('POST /api/integration/sso-handoff — EXISTING tenant branch (regression)', () => {
        it('still mints a { userId, tenantId } code for a (tenantId, email) tenant user', async () => {
            await seedTenantUser(TENANT_USER_ID, TENANT_USER_EMAIL);

            const res = await postHandoff({ tenantId: TENANT_ID, email: TENANT_USER_EMAIL });
            expect(res.status).toBe(200);
            const body = await res.json() as { success: boolean; data: { code: string } };
            expect(body.success).toBe(true);

            const raw = await kv.get(`sso:${body.data.code}`);
            const parsed = JSON.parse(raw!);
            expect(parsed).toEqual({ userId: TENANT_USER_ID, tenantId: TENANT_ID });
        });

        it('404s when no tenant user matches (tenantId, email)', async () => {
            const res = await postHandoff({ tenantId: TENANT_ID, email: 'ghost@example.com' });
            expect(res.status).toBe(404);
        });
    });

    describe('GET /api/auth/sso — agent (tenant-null) branch', () => {
        it('mints agent JWT (no tenantId) + cookie + 302 /agent-dashboard; single-use', async () => {
            await seedGlobalAgent(AGENT_USER_ID, AGENT_EMAIL);
            await kv.put('sso:agent-code-1', JSON.stringify({ userId: AGENT_USER_ID }));

            const consumeApp = buildConsumeApp();
            const res = await consumeApp.request('/api/auth/sso?code=agent-code-1');

            expect(res.status).toBe(302);
            expect(res.headers.get('location')).toBe('/agent-dashboard');
            expect(res.headers.get('set-cookie')).toContain('__Host-inspector_token');

            expect(signJwtMock).toHaveBeenCalledTimes(1);
            const [claims] = signJwtMock.mock.calls[0] as [Record<string, unknown>];
            expect(claims).toMatchObject({
                sub: AGENT_USER_ID, role: 'agent', 'custom:userRole': 'agent', email: AGENT_EMAIL,
            });
            expect(claims).not.toHaveProperty('custom:tenantId');
            expect(claims).not.toHaveProperty('tenantId');

            // Single-use: the code was deleted on first redeem.
            const res2 = await consumeApp.request('/api/auth/sso?code=agent-code-1');
            expect(res2.status).toBe(302);
            expect(res2.headers.get('location')).toBe('/login?sso=expired');
            expect(res2.headers.get('set-cookie')).toBeNull();
            expect(signJwtMock).toHaveBeenCalledTimes(1);
        });

        it('re-verifies at redeem time — since-deleted/demoted agent -> /login?sso=invalid, no cookie', async () => {
            // Deliberately no users row for this id (simulates deletion/demotion
            // during the code's TTL window).
            await kv.put('sso:agent-code-2', JSON.stringify({ userId: 'ghost-user' }));

            const consumeApp = buildConsumeApp();
            const res = await consumeApp.request('/api/auth/sso?code=agent-code-2');
            expect(res.status).toBe(302);
            expect(res.headers.get('location')).toBe('/login?sso=invalid');
            expect(res.headers.get('set-cookie')).toBeNull();
            expect(signJwtMock).not.toHaveBeenCalled();
        });

        it('end-to-end: handoff-issued agent code is redeemable by the consumer', async () => {
            await seedGlobalAgent(AGENT_USER_ID, AGENT_EMAIL);

            const handoffRes = await postHandoff({ email: AGENT_EMAIL });
            expect(handoffRes.status).toBe(200);
            const { data } = await handoffRes.json() as { data: { code: string } };

            const consumeApp = buildConsumeApp();
            const res = await consumeApp.request(`/api/auth/sso?code=${data.code}`);
            expect(res.status).toBe(302);
            expect(res.headers.get('location')).toBe('/agent-dashboard');
            expect(res.headers.get('set-cookie')).toContain('__Host-inspector_token');
        });
    });

    describe('GET /api/auth/sso — EXISTING tenant branch (regression)', () => {
        it('still mints a tenant JWT with custom:tenantId and redirects to /inspections', async () => {
            await seedTenantUser(TENANT_USER_ID, TENANT_USER_EMAIL);
            await kv.put('sso:tenant-code-1', JSON.stringify({ userId: TENANT_USER_ID, tenantId: TENANT_ID }));

            const consumeApp = buildConsumeApp();
            const res = await consumeApp.request('/api/auth/sso?code=tenant-code-1');

            expect(res.status).toBe(302);
            expect(res.headers.get('location')).toBe('/inspections');
            expect(res.headers.get('set-cookie')).toContain('__Host-inspector_token');

            const [claims] = signJwtMock.mock.calls[0] as [Record<string, unknown>];
            expect(claims).toMatchObject({
                sub: TENANT_USER_ID, 'custom:tenantId': TENANT_ID, 'custom:sso': true,
            });
        });
    });
});
