/**
 * Spec 3 Task 5 — core `/agent-login` dual-mode front door (password +
 * magic-link). Harness mirrors tests/unit/agent/magic-login.spec.ts (real
 * seeded better-sqlite3 db behind a mocked drizzle('drizzle-orm/d1'), mocked
 * signJwt) since the route under test does real findGlobalAgentByEmail /
 * magic-login.service drizzle queries.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { hashPassword } from '../../../server/lib/password';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const { signJwtMock } = vi.hoisted(() => ({
    signJwtMock: vi.fn(async (payload: Record<string, unknown>) => `fake.jwt.${JSON.stringify(payload)}`),
}));
vi.mock('../../../server/lib/jwt-keyring', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/lib/jwt-keyring')>();
    return { ...actual, signJwt: signJwtMock };
});

import { OpenAPIHono } from '@hono/zod-openapi';
// eslint-disable-next-line import/order
import { agentLoginRoutes } from '../../../server/api/agent/login';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

/** Mirrors server/index.ts's global onError — see magic-login.spec.ts. */
function withErrorHandler(app: OpenAPIHono<HonoConfig>) {
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    return app;
}

const TENANT_ID = '00000000-0000-0000-0000-0000000000a1';
const AGENT_USER_ID = '00000000-0000-0000-0000-0000000000c1';
const AGENT_EMAIL = 'agent@example.com';
const TENANT_USER_ID = '00000000-0000-0000-0000-0000000000d1';
const TENANT_USER_EMAIL = 'owner@example.com';
const PASSWORD = 'CorrectHorse123!Battery';

/** Minimal in-memory KV stub — get/put/delete, mirrors makeKv in magic-login.spec.ts. */
function makeKv(seed: Record<string, string> = {}) {
    const store = new Map<string, string>(Object.entries(seed));
    return {
        get: async (k: string) => store.get(k) ?? null,
        put: async (k: string, v: string) => { store.set(k, v); },
        delete: async (k: string) => { store.delete(k); },
        store,
    };
}

describe('Agent password + magic-link login (core /agent-login front door)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    let sendAgentLoginLink: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        signJwtMock.mockClear();
        sendAgentLoginLink = vi.fn().mockResolvedValue(undefined);

        await db.insert(schema.tenants).values({
            id: TENANT_ID, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as any);
    });

    afterEach(() => sqlite.close());

    async function seedGlobalAgent(id: string, email: string, password: string) {
        await db.insert(schema.users).values({
            id, tenantId: null, email, name: 'Agent Smith', role: 'agent',
            createdAt: new Date(), passwordHash: await hashPassword(password),
        } as any);
    }

    async function seedTenantUser(id: string, email: string, password: string) {
        await db.insert(schema.users).values({
            id, tenantId: TENANT_ID, email, name: 'Tenant Owner', role: 'owner',
            createdAt: new Date(), passwordHash: await hashPassword(password),
        } as any);
    }

    function buildApp(kv: ReturnType<typeof makeKv>) {
        const app = withErrorHandler(new OpenAPIHono<HonoConfig>());
        app.use('*', async (c, next) => {
            c.env = { DB: {}, TENANT_CACHE: kv } as unknown as HonoConfig['Bindings'];
            c.set('keyringPromise', Promise.resolve({}) as unknown as HonoConfig['Variables']['keyringPromise']);
            c.set('services', {
                email: { sendAgentLoginLink },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/agent', agentLoginRoutes);
        return app;
    }

    describe('POST /api/agent/login', () => {
        it('valid agent email + password → sets __Host-inspector_token with agent claims (no tenantId) + { ok: true }', async () => {
            await seedGlobalAgent(AGENT_USER_ID, AGENT_EMAIL, PASSWORD);
            const app = buildApp(makeKv());

            const res = await app.request('/api/agent/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: AGENT_EMAIL, password: PASSWORD }),
            });

            expect(res.status).toBe(200);
            const body = await res.json() as { data: { ok: boolean } };
            expect(body.data.ok).toBe(true);
            expect(res.headers.get('set-cookie')).toContain('__Host-inspector_token');

            expect(signJwtMock).toHaveBeenCalledTimes(1);
            const [claims] = signJwtMock.mock.calls[0] as [Record<string, unknown>];
            expect(claims).toMatchObject({
                sub: AGENT_USER_ID, role: 'agent', 'custom:userRole': 'agent', email: AGENT_EMAIL,
            });
            expect(claims).not.toHaveProperty('tenantId');
            expect(claims).not.toHaveProperty('custom:tenantId');
        });

        it('wrong password for a real agent account → generic 401, no cookie', async () => {
            await seedGlobalAgent(AGENT_USER_ID, AGENT_EMAIL, PASSWORD);
            const app = buildApp(makeKv());

            const res = await app.request('/api/agent/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: AGENT_EMAIL, password: 'totally-wrong' }),
            });

            expect(res.status).toBe(401);
            expect(res.headers.get('set-cookie')).toBeNull();
            expect(signJwtMock).not.toHaveBeenCalled();
        });

        it('unknown email → generic 401, no cookie (anti-oracle — same shape as wrong password)', async () => {
            const app = buildApp(makeKv());

            const res = await app.request('/api/agent/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'nobody@example.com', password: PASSWORD }),
            });

            expect(res.status).toBe(401);
            expect(res.headers.get('set-cookie')).toBeNull();
            expect(signJwtMock).not.toHaveBeenCalled();
        });

        it('a TENANT user\'s email (not a global agent) → 401, never authenticates here', async () => {
            await seedTenantUser(TENANT_USER_ID, TENANT_USER_EMAIL, PASSWORD);
            const app = buildApp(makeKv());

            const res = await app.request('/api/agent/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                // Correct password for that tenant user — must still 401,
                // because findGlobalAgentByEmail excludes tenant-scoped rows.
                body: JSON.stringify({ email: TENANT_USER_EMAIL, password: PASSWORD }),
            });

            expect(res.status).toBe(401);
            expect(res.headers.get('set-cookie')).toBeNull();
            expect(signJwtMock).not.toHaveBeenCalled();
        });
    });

    describe('POST /api/agent/login-link', () => {
        it('existing agent account → code minted in KV + email send invoked', async () => {
            await seedGlobalAgent(AGENT_USER_ID, AGENT_EMAIL, PASSWORD);
            const kv = makeKv();
            const app = buildApp(kv);

            const res = await app.request('/api/agent/login-link', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: AGENT_EMAIL }),
            });

            expect(res.status).toBe(200);
            const body = await res.json() as { data: { sent: boolean } };
            expect(body.data.sent).toBe(true);

            expect(kv.store.size).toBe(1);
            const [key, raw] = [...kv.store.entries()][0];
            expect(key).toMatch(/^agent_ml:/);
            expect(JSON.parse(raw)).toMatchObject({ userId: AGENT_USER_ID });

            expect(sendAgentLoginLink).toHaveBeenCalledTimes(1);
            const [toArg, urlArg] = sendAgentLoginLink.mock.calls[0] as [string, string];
            expect(toArg).toBe(AGENT_EMAIL);
            expect(urlArg).toMatch(/\/agent\/magic-login\?code=[0-9a-f-]+$/);
        });

        it('unknown email → { sent: true } + no KV write, no email send (anti-oracle)', async () => {
            const kv = makeKv();
            const app = buildApp(kv);

            const res = await app.request('/api/agent/login-link', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'nobody@example.com' }),
            });

            expect(res.status).toBe(200);
            const body = await res.json() as { data: { sent: boolean } };
            expect(body.data.sent).toBe(true);
            expect(kv.store.size).toBe(0);
            expect(sendAgentLoginLink).not.toHaveBeenCalled();
        });

        it('a TENANT user\'s email → { sent: true } + no KV write (not a global agent account)', async () => {
            await seedTenantUser(TENANT_USER_ID, TENANT_USER_EMAIL, PASSWORD);
            const kv = makeKv();
            const app = buildApp(kv);

            const res = await app.request('/api/agent/login-link', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: TENANT_USER_EMAIL }),
            });

            expect(res.status).toBe(200);
            const body = await res.json() as { data: { sent: boolean } };
            expect(body.data.sent).toBe(true);
            expect(kv.store.size).toBe(0);
            expect(sendAgentLoginLink).not.toHaveBeenCalled();
        });
    });
});

/**
 * Allowlist guard. Both entry points are UNAUTHENTICATED (no session, no
 * report token) and must bypass the global JWT middleware
 * (`isAgentPublic` in server/index.ts) so a stale/expired session cookie on
 * the visiting browser can never 401 either request. Exercises the REAL
 * exported jwtAuthMiddleware directly, mirroring
 * tests/unit/agent/magic-login.spec.ts's own allowlist guard.
 */
describe('Agent login/login-link — jwtAuthMiddleware allowlist', { timeout: 30_000 }, () => {
    it('bypasses JWT verification for both entry points regardless of a stale Bearer token', async () => {
        const { jwtAuthMiddleware } = await import('../../../server/index');
        for (const path of ['/api/agent/login', '/api/agent/login-link']) {
            const next = vi.fn(async () => {});
            const fakeContext = {
                req: {
                    path,
                    header: () => 'Bearer this-is-a-stale-or-garbage-token',
                },
            } as unknown as Parameters<typeof jwtAuthMiddleware>[0];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (jwtAuthMiddleware as any)(fakeContext, next);
            expect(next, `${path} did not bypass jwtAuthMiddleware`).toHaveBeenCalledTimes(1);
        }
    });
});
