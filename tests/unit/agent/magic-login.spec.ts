/**
 * Agent unified link (Spec 3, Task 2) — single-use magic-login primitive.
 *
 * Harness mirrors tests/unit/auth/sso-return-to.spec.ts (route + fake KV +
 * mocked signJwt) and tests/unit/portal/agent-self-retrieve.spec.ts (real
 * seeded better-sqlite3 db behind a mocked drizzle('drizzle-orm/d1')) — the
 * service under test does real PeopleService/account.ts drizzle queries, so a
 * real DB gives higher-fidelity coverage than hand-rolled chain stubs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

import { OpenAPIHono } from '@hono/zod-openapi';
// eslint-disable-next-line import/order
import {
    agentMagicLoginRequestRoutes,
    agentMagicLoginRedeemRoutes,
} from '../../../server/api/agent/magic-login';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

/** Mirrors server/index.ts's global onError — the standalone test app has no
 * such handler by default, so a thrown AppError (e.g. Errors.Unauthorized())
 * would otherwise surface as a generic 500 instead of its real status. */
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
const INSP_ID = '00000000-0000-0000-0000-0000000000b1';
const AGENT_USER_ID = '00000000-0000-0000-0000-0000000000c1';
const AGENT_EMAIL = 'agent@example.com';

/** Minimal in-memory KV stub — get/put/delete, mirrors makeKv in sso-return-to.spec.ts. */
function makeKv(seed: Record<string, string> = {}) {
    const store = new Map<string, string>(Object.entries(seed));
    return {
        get: async (k: string) => store.get(k) ?? null,
        put: async (k: string, v: string) => { store.set(k, v); },
        delete: async (k: string) => { store.delete(k); },
        store,
    };
}

describe('Agent magic-login primitive', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any; // eslint-disable-line @typescript-eslint/no-explicit-any

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        signJwtMock.mockClear();

        await db.insert(schema.tenants).values({
            id: TENANT_ID, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as any);
    });

    afterEach(() => sqlite.close());

    async function seedRoleProfile(key: string, kind: 'agent' | 'client' | 'other') {
        const now = new Date();
        await db.insert(schema.contactRoleProfiles).values({
            id: crypto.randomUUID(), tenantId: TENANT_ID, key, label: key,
            kind, isSystem: false, sortOrder: 0, active: true,
            createdAt: now, updatedAt: now,
        } as any);
    }

    async function seedGlobalAgent(id: string, email: string) {
        await db.insert(schema.users).values({
            id, tenantId: null, email, name: 'Agent Smith', role: 'agent',
            createdAt: new Date(), passwordHash: 'x',
        } as any);
    }

    function buildRequestApp(resolveToken: ReturnType<typeof vi.fn>, kv: ReturnType<typeof makeKv>) {
        // The request route now EMAILS the single-use link (never returns it), so
        // stub the email service and expose the spy for assertions.
        const sendAgentLoginLink = vi.fn().mockResolvedValue(undefined);
        const app = withErrorHandler(new OpenAPIHono<HonoConfig>());
        app.use('*', async (c, next) => {
            c.env = { DB: {}, TENANT_CACHE: kv } as unknown as HonoConfig['Bindings'];
            c.set('services', { portalAccess: { resolveToken }, email: { sendAgentLoginLink } } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/agent', agentMagicLoginRequestRoutes);
        return { app, sendAgentLoginLink };
    }

    function buildRedeemApp(kv: ReturnType<typeof makeKv>) {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.env = { DB: {}, TENANT_CACHE: kv } as unknown as HonoConfig['Bindings'];
            c.set('keyringPromise', Promise.resolve({}) as unknown as HonoConfig['Variables']['keyringPromise']);
            await next();
        });
        app.route('/', agentMagicLoginRedeemRoutes);
        return app;
    }

    describe('POST /api/agent/magic-login/request', () => {
        it('valid agent-kind token + email with an agent account → link EMAILED to the agent, KV seeded, { sent: true }', async () => {
            await seedRoleProfile('buyer_agent', 'agent');
            await seedGlobalAgent(AGENT_USER_ID, AGENT_EMAIL);

            const resolveToken = vi.fn().mockResolvedValue({
                inspectionId: INSP_ID, tenantId: TENANT_ID, role: 'buyer_agent',
                recipientEmail: AGENT_EMAIL, revokedAt: null, expiresAt: null,
            });
            const kv = makeKv();
            const { app, sendAgentLoginLink } = buildRequestApp(resolveToken, kv);

            const res = await app.request('/api/agent/magic-login/request', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ tenant: 'acme', inspectionId: INSP_ID, token: 'live-report-token' }),
            });

            expect(res.status).toBe(200);
            const body = await res.json() as { data: { sent: boolean } };
            expect(body.data.sent).toBe(true);
            expect(resolveToken).toHaveBeenCalledWith('live-report-token');

            // The single-use link is EMAILED to the agent's own inbox, never
            // returned to the caller (closes the report-link → session takeover).
            expect(sendAgentLoginLink).toHaveBeenCalledTimes(1);
            const [toEmail, loginUrl] = sendAgentLoginLink.mock.calls[0] as [string, string];
            expect(toEmail).toBe(AGENT_EMAIL);
            expect(loginUrl).toMatch(/\/agent\/magic-login\?code=[0-9a-f-]+$/);

            const code = new URL(loginUrl, 'http://x').searchParams.get('code');
            const raw = await kv.get(`agent_ml:${code}`);
            expect(raw).not.toBeNull();
            expect(JSON.parse(raw!)).toMatchObject({ userId: AGENT_USER_ID });
        });

        it('no agent account for the recipient email → { sent: true }, no email, no KV write (anti-oracle)', async () => {
            await seedRoleProfile('buyer_agent', 'agent');
            // Deliberately no users row for this email.

            const resolveToken = vi.fn().mockResolvedValue({
                inspectionId: INSP_ID, tenantId: TENANT_ID, role: 'buyer_agent',
                recipientEmail: 'nobody@example.com', revokedAt: null, expiresAt: null,
            });
            const kv = makeKv();
            const { app, sendAgentLoginLink } = buildRequestApp(resolveToken, kv);

            const res = await app.request('/api/agent/magic-login/request', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ tenant: 'acme', inspectionId: INSP_ID, token: 'live-report-token' }),
            });

            // Anti-oracle: identical { sent: true } response, but no email + no KV
            // write when no agent account exists for the recipient.
            expect(res.status).toBe(200);
            const body = await res.json() as { data: { sent: boolean } };
            expect(body.data.sent).toBe(true);
            expect(sendAgentLoginLink).not.toHaveBeenCalled();
            expect(kv.store.size).toBe(0);
        });

        it('invalid/revoked/expired/inspection-mismatched report token → 401', async () => {
            const resolveToken = vi.fn().mockResolvedValue(null);
            const kv = makeKv();
            const { app } = buildRequestApp(resolveToken, kv);

            const res = await app.request('/api/agent/magic-login/request', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ tenant: 'acme', inspectionId: INSP_ID, token: 'bad-token' }),
            });

            expect(res.status).toBe(401);
            expect(kv.store.size).toBe(0);
        });

        it('valid CLIENT-kind token (not agent) → 401, never mints a code', async () => {
            await seedRoleProfile('client', 'client');

            const resolveToken = vi.fn().mockResolvedValue({
                inspectionId: INSP_ID, tenantId: TENANT_ID, role: 'client',
                recipientEmail: 'client@example.com', revokedAt: null, expiresAt: null,
            });
            const kv = makeKv();
            const { app } = buildRequestApp(resolveToken, kv);

            const res = await app.request('/api/agent/magic-login/request', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ tenant: 'acme', inspectionId: INSP_ID, token: 'client-token' }),
            });

            expect(res.status).toBe(401);
            expect(kv.store.size).toBe(0);
        });
    });

    describe('GET /agent/magic-login (redeem)', () => {
        it('redeems a valid code → agent JWT claims (no tenantId) + cookie + 302 /agent-dashboard; single-use', async () => {
            await seedGlobalAgent(AGENT_USER_ID, AGENT_EMAIL);
            const kv = makeKv({
                'agent_ml:code-1': JSON.stringify({ userId: AGENT_USER_ID, issuedAt: Date.now() }),
            });
            const app = buildRedeemApp(kv);

            const res = await app.request('/agent/magic-login?code=code-1');
            expect(res.status).toBe(302);
            expect(res.headers.get('location')).toBe('/agent-dashboard');
            expect(res.headers.get('set-cookie')).toContain('__Host-inspector_token');

            expect(signJwtMock).toHaveBeenCalledTimes(1);
            const [claims] = signJwtMock.mock.calls[0] as [Record<string, unknown>];
            expect(claims).toMatchObject({
                sub: AGENT_USER_ID, role: 'agent', 'custom:userRole': 'agent', email: AGENT_EMAIL,
            });
            expect(claims).not.toHaveProperty('tenantId');
            expect(claims).not.toHaveProperty('custom:tenantId');

            // Single-use: the code is deleted on first redeem, so a second attempt fails.
            const res2 = await app.request('/agent/magic-login?code=code-1');
            expect(res2.status).toBe(302);
            expect(res2.headers.get('location')).toBe('/agent-login?error=expired_link');
            expect(res2.headers.get('set-cookie')).toBeNull();
        });

        it('missing/expired code → friendly redirect, no cookie', async () => {
            const kv = makeKv();
            const app = buildRedeemApp(kv);

            const res = await app.request('/agent/magic-login?code=never-issued');
            expect(res.status).toBe(302);
            expect(res.headers.get('location')).toBe('/agent-login?error=expired_link');
            expect(res.headers.get('set-cookie')).toBeNull();
            expect(signJwtMock).not.toHaveBeenCalled();
        });

        it('code for a since-deleted agent account → friendly redirect (re-verified at redeem time)', async () => {
            // No users row seeded for this id — simulates deletion/demotion
            // during the code's TTL window.
            const kv = makeKv({
                'agent_ml:code-2': JSON.stringify({ userId: 'ghost-user', issuedAt: Date.now() }),
            });
            const app = buildRedeemApp(kv);

            const res = await app.request('/agent/magic-login?code=code-2');
            expect(res.status).toBe(302);
            expect(res.headers.get('location')).toBe('/agent-login?error=expired_link');
            expect(res.headers.get('set-cookie')).toBeNull();
        });
    });
});

/**
 * SaaS-bounce / allowlist guard.
 *
 * Both entry points are UNAUTHENTICATED (report token or one-time KV code,
 * never a session) and must bypass the global JWT middleware's allowlist
 * (`isAgentPublic` in server/index.ts) so a stale/expired session cookie on
 * the visiting browser can never 401 the redeem hop. This exercises the REAL
 * exported jwtAuthMiddleware directly (not a hand-rolled copy of the
 * predicate) — importing server/index.ts pulls the whole app graph, so it
 * gets its own generous timeout (mirrors tests/unit/platform/route-metadata
 * and middleware-order specs).
 *
 * TODO(agent-unified-link): the full SaaS-mode `/login` portal-bounce
 * non-interference assertion (APP_MODE='saas' + PORTAL_API_URL set, proving
 * GET /agent/magic-login does NOT 302 to the portal and DOES mint the agent
 * cookie) is deferred to the Task 8 E2E suite, which can drive the actual
 * worker entry (workers/app.ts) rather than a unit-level Hono app.
 */
describe('Agent magic-login — jwtAuthMiddleware allowlist', { timeout: 60_000 }, () => {
    it('bypasses JWT verification for both entry points regardless of a stale Bearer token', async () => {
        const { jwtAuthMiddleware } = await import('../../../server/index');
        for (const path of ['/agent/magic-login', '/api/agent/magic-login/request']) {
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
