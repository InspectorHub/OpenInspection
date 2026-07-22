import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { HonoConfig } from '../../../server/types/hono';
import { signMagicLink } from '../../../server/lib/portal-session';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const { signJwtMock } = vi.hoisted(() => ({
    signJwtMock: vi.fn(async (payload: Record<string, unknown>) => `fake.jwt.${JSON.stringify(payload)}`),
}));
vi.mock('../../../server/lib/jwt-keyring', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/lib/jwt-keyring')>();
    return { ...actual, signJwt: signJwtMock };
});

// eslint-disable-next-line import/order
import portalRoutes from '../../../server/api/portal';
import { PortalService } from '../../../server/services/portal.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';

/**
 * Spec 3 Task 7 — GET /api/portal/:tenant/redeem (find-my-report magic-link
 * redemption) must route a GLOBAL AGENT email to an agent session instead of
 * the client __Host-portal_session cookie. This is the find-my-report
 * analogue of Task 6's exchangeRoute agent branch, except the signal here is
 * findGlobalAgentByEmail (a separate global-account lookup) rather than a
 * per-token role kind — the magic-link path carries no token/grant object,
 * only a verified email.
 *
 * SECURITY invariant under test: an agent redeeming this link gets
 * __Host-inspector_token (agent claims, NO tenantId) and NEVER
 * __Host-portal_session. Client/co_client redemption is unchanged (regression).
 */
const TENANT = '00000000-0000-0000-0000-0000000000f7';
const JWT_SECRET = 'test-jwt-secret-find-my-report';

describe('GET /api/portal/:tenant/redeem — find-my-report agent destination', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    function buildApp() {
        const portalSvc = new PortalService({} as D1Database, { getObserveProgress: async () => { throw new Error('unused in this suite'); } });
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('tenantId', TENANT);
            c.set('requestedTenantSlug', 'acme-fmr');
            c.set('keyringPromise', Promise.resolve({}) as unknown as HonoConfig['Variables']['keyringPromise']);
            c.set('services', { portal: portalSvc } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/portal', portalRoutes);
        return app;
    }

    async function seedGlobalAgent(id: string, email: string) {
        await testDb.insert(schema.users).values({
            id, tenantId: null, email, name: 'Agent Smith', role: 'agent',
            createdAt: new Date(), passwordHash: 'x',
        } as never);
    }

    async function seedInsp(id: string) {
        await testDb.insert(schema.inspections).values({
            id, tenantId: TENANT, propertyAddress: `${id} Main St`, date: '2026-06-01',
            status: 'requested', reportStatus: 'in_progress', paymentStatus: 'unpaid', createdAt: new Date(),
        } as never);
    }

    async function seedToken(inspectionId: string, email: string, role: string) {
        await testDb.insert(schema.inspectionAccessTokens).values({
            id: crypto.randomUUID(), tenantId: TENANT, inspectionId, recipientEmail: email, role,
            token: crypto.randomUUID(), createdAt: new Date(), expiresAt: null, revokedAt: null,
        } as never);
    }

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        signJwtMock.mockClear();
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme-fmr', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as never);
        await seedRoleProfiles(testDb, TENANT, new Date(1));
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    function reqEnv() { return { DB: {}, JWT_SECRET } as unknown as HonoConfig['Bindings']; }

    it('a global agent email -> sets __Host-inspector_token (agent claims, no tenantId), NO __Host-portal_session, { agent: true }', async () => {
        const AGENT_ID = '00000000-0000-0000-0000-0000000000a9';
        const AGENT_EMAIL = 'agent@example.com';
        await seedGlobalAgent(AGENT_ID, AGENT_EMAIL);
        const link = await signMagicLink(JWT_SECRET, AGENT_EMAIL);

        const res = await buildApp().request(
            `/api/portal/acme-fmr/redeem?link=${encodeURIComponent(link)}`, {}, reqEnv());

        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { email: string; agent?: boolean } };
        expect(body.data.email).toBe(AGENT_EMAIL);
        expect(body.data.agent).toBe(true);

        const setCookieHeaders = res.headers.getSetCookie
            ? res.headers.getSetCookie()
            : [res.headers.get('set-cookie') ?? ''];
        const joined = setCookieHeaders.join('\n');
        expect(joined).toContain('__Host-inspector_token=');
        // SECURITY: the whole point of this task — the client session cookie
        // must NEVER be set for an agent redeem.
        expect(joined).not.toContain('__Host-portal_session=');

        expect(signJwtMock).toHaveBeenCalledTimes(1);
        const [claims] = signJwtMock.mock.calls[0] as [Record<string, unknown>];
        expect(claims).toMatchObject({
            sub: AGENT_ID, role: 'agent', 'custom:userRole': 'agent', email: AGENT_EMAIL,
        });
        expect(claims).not.toHaveProperty('tenantId');
        expect(claims).not.toHaveProperty('custom:tenantId');
    });

    it('regression: a client email (no global agent account) -> unchanged __Host-portal_session mint, no agent flag, no signJwt call', async () => {
        const CLIENT_EMAIL = 'client@example.com';
        const link = await signMagicLink(JWT_SECRET, CLIENT_EMAIL);

        const res = await buildApp().request(
            `/api/portal/acme-fmr/redeem?link=${encodeURIComponent(link)}`, {}, reqEnv());

        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { email: string; agent?: boolean } };
        expect(body.data.email).toBe(CLIENT_EMAIL);
        expect(body.data.agent).toBeUndefined();
        expect(res.headers.get('set-cookie') ?? '').toContain('__Host-portal_session=');
        expect(signJwtMock).not.toHaveBeenCalled();
    });

    it('#9 dual identity: a global-agent email that ALSO holds a live client grant -> client __Host-portal_session, NOT agent', async () => {
        const DUAL_EMAIL = 'dual@example.com';
        await seedGlobalAgent('00000000-0000-0000-0000-0000000000aa', DUAL_EMAIL);
        await seedInsp('insp-dual');
        await seedToken('insp-dual', DUAL_EMAIL, 'client');   // client-KIND grant
        const link = await signMagicLink(JWT_SECRET, DUAL_EMAIL);

        const res = await buildApp().request(
            `/api/portal/acme-fmr/redeem?link=${encodeURIComponent(link)}`, {}, reqEnv());

        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { email: string; agent?: boolean } };
        expect(body.data.email).toBe(DUAL_EMAIL);
        // Genuine client on this inspection — must reach the client portal even
        // though the email also has a global agent account.
        expect(body.data.agent).toBeUndefined();
        expect(res.headers.get('set-cookie') ?? '').toContain('__Host-portal_session=');
        expect(signJwtMock).not.toHaveBeenCalled();
    });

    it('#9 guard: a global agent holding only an AGENT-kind grant still routes to the agent dashboard (client-kind check must not match agents)', async () => {
        const AGENT_EMAIL = 'buyeragent@example.com';
        await seedGlobalAgent('00000000-0000-0000-0000-0000000000ab', AGENT_EMAIL);
        await seedInsp('insp-agent');
        await seedToken('insp-agent', AGENT_EMAIL, 'buyer_agent');  // agent-KIND grant (has selfRetrieveReport)
        const link = await signMagicLink(JWT_SECRET, AGENT_EMAIL);

        const res = await buildApp().request(
            `/api/portal/acme-fmr/redeem?link=${encodeURIComponent(link)}`, {}, reqEnv());

        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { email: string; agent?: boolean } };
        expect(body.data.agent).toBe(true);
        const joined = (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie') ?? '']).join('\n');
        expect(joined).toContain('__Host-inspector_token=');
        expect(joined).not.toContain('__Host-portal_session=');
        expect(signJwtMock).toHaveBeenCalledTimes(1);
    });

    it('regression: an invalid/expired magic-link token -> unchanged 401, no cookie, no signJwt call', async () => {
        const res = await buildApp().request(
            '/api/portal/acme-fmr/redeem?link=not-a-real-token', {}, reqEnv());

        expect(res.status).toBe(401);
        expect(res.headers.get('set-cookie')).toBeNull();
        expect(signJwtMock).not.toHaveBeenCalled();
    });
});
