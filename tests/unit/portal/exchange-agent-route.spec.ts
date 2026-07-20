import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { HonoConfig } from '../../../server/types/hono';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { PortalService } from '../../../server/services/portal.service';
import { PeopleService } from '../../../server/services/people.service';
import portalRoutes from '../../../server/api/portal';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Spec 3 Task 6, Part A — GET /api/portal/:tenant/exchange must NEVER mint a
// client __Host-portal_session for an agent-kind token, even though the
// Task 1 capability flip (capabilitiesForKind('agent').selfRetrieveReport =
// true) now lets an agent's role KEY pass the selfRetrieveReport gate. The
// route must resolve the grant's role KIND (kindForKey) and branch BEFORE
// minting: agent-kind -> 200 { data: { email, agent: true } }, NO Set-Cookie;
// client/co_client -> unchanged mint path; neither-capable-nor-agent -> 403.
const TENANT = '00000000-0000-0000-0000-0000000000e6';

describe('GET /api/portal/:tenant/exchange — agent tokens never mint a client session', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    function makePortalAccessStub() {
        return {
            resolveToken: async (token: string) => {
                const rows = await testDb.select().from(schema.inspectionAccessTokens);
                const row = rows.find((r) => r.token === token);
                if (!row) return null;
                return {
                    inspectionId: row.inspectionId,
                    tenantId: row.tenantId,
                    role: row.role,
                    recipientEmail: row.recipientEmail,
                    revokedAt: row.revokedAt ? row.revokedAt.getTime() : null,
                    expiresAt: row.expiresAt ? row.expiresAt.getTime() : null,
                };
            },
        };
    }

    function buildApp() {
        const portalSvc = new PortalService({} as D1Database, { getObserveProgress: async () => { throw new Error('unused in this suite'); } });
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('tenantId', TENANT);
            c.set('requestedTenantSlug', 'acme-exchange-agent');
            c.set('services', {
                portal: portalSvc,
                email: { sendEmail: vi.fn() },
                portalAccess: makePortalAccessStub(),
                people: new PeopleService({ DB: {} as D1Database }),
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/portal', portalRoutes);
        return app;
    }

    async function seedInsp(id: string) {
        await testDb.insert(schema.inspections).values({
            id, tenantId: TENANT, propertyAddress: `${id} Main St`, date: '2026-06-01',
            status: 'requested', reportStatus: 'in_progress', paymentStatus: 'unpaid', createdAt: new Date(),
        } as never);
    }
    async function seedTokReturning(inspectionId: string, email: string, role: string) {
        const token = crypto.randomUUID();
        await testDb.insert(schema.inspectionAccessTokens).values({
            id: crypto.randomUUID(), tenantId: TENANT, inspectionId, recipientEmail: email, role,
            token, createdAt: new Date(), expiresAt: null, revokedAt: null,
        } as never);
        return token;
    }

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme-exchange-agent', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as never);
        await seedRoleProfiles(testDb, TENANT, new Date(1));
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    function reqEnv() {
        return { JWT_SECRET: 'test-jwt-secret-exchange-agent' } as unknown as HonoConfig['Bindings'];
    }

    it('an agent-kind grant (buyer_agent) -> 200 { data: { email, agent: true } }, NO __Host-portal_session cookie', async () => {
        await seedInsp('insp1');
        const token = await seedTokReturning('insp1', 'agent@x.com', 'buyer_agent');
        const res = await buildApp().request(
            `/api/portal/acme-exchange-agent/exchange?token=${encodeURIComponent(token)}&inspectionId=insp1`, {}, reqEnv());
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { email: string; agent?: boolean } };
        expect(body.data.email).toBe('agent@x.com');
        expect(body.data.agent).toBe(true);
        // SECURITY: the whole point of this task — an agent token must NEVER
        // mint the client session cookie.
        expect(res.headers.get('set-cookie')).toBeNull();
    });

    it('a second agent-kind grant (listing_agent) -> same no-session behavior', async () => {
        await seedInsp('insp1');
        const token = await seedTokReturning('insp1', 'listing@x.com', 'listing_agent');
        const res = await buildApp().request(
            `/api/portal/acme-exchange-agent/exchange?token=${encodeURIComponent(token)}&inspectionId=insp1`, {}, reqEnv());
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { email: string; agent?: boolean } };
        expect(body.data.agent).toBe(true);
        expect(res.headers.get('set-cookie')).toBeNull();
    });

    it('regression: a client-role grant still mints the session cookie and omits `agent`', async () => {
        await seedInsp('insp1');
        const token = await seedTokReturning('insp1', 'client@x.com', 'client');
        const res = await buildApp().request(
            `/api/portal/acme-exchange-agent/exchange?token=${encodeURIComponent(token)}&inspectionId=insp1`, {}, reqEnv());
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { email: string; agent?: boolean } };
        expect(body.data.email).toBe('client@x.com');
        expect(body.data.agent).toBeUndefined();
        expect(res.headers.get('set-cookie') ?? '').toContain('__Host-portal_session=');
    });

    it('regression: a co_client-role grant still mints the session cookie', async () => {
        await seedInsp('insp1');
        const token = await seedTokReturning('insp1', 'coclient@x.com', 'co_client');
        const res = await buildApp().request(
            `/api/portal/acme-exchange-agent/exchange?token=${encodeURIComponent(token)}&inspectionId=insp1`, {}, reqEnv());
        expect(res.status).toBe(200);
        expect(res.headers.get('set-cookie') ?? '').toContain('__Host-portal_session=');
        const body = (await res.json()) as { data: { agent?: boolean } };
        expect(body.data.agent).toBeUndefined();
    });

    it('a non-capable, non-agent role key (e.g. unknown "vendor-literal") -> 403, no cookie', async () => {
        await seedInsp('insp1');
        // Not a seeded default key at all, so it fails the selfRetrieveKeys
        // membership check before the kind branch is ever reached.
        const token = await seedTokReturning('insp1', 'nope@x.com', 'not-a-real-role-key');
        const res = await buildApp().request(
            `/api/portal/acme-exchange-agent/exchange?token=${encodeURIComponent(token)}&inspectionId=insp1`, {}, reqEnv());
        expect(res.status).toBe(403);
        expect(res.headers.get('set-cookie')).toBeNull();
    });
});
