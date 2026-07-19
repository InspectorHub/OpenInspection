import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { HonoConfig } from '../../../server/types/hono';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';

// find-my-report discovery + hub exchange must derive "can this grant
// self-retrieve the report" from the role-profile KIND's selfRetrieveReport
// capability (server/lib/people/capabilities.ts), not from a hard-coded
// ['client', 'co_client'] literal list. The differentiator: a CUSTOM,
// non-literal role key whose kind is 'client' must be treated the same as
// the seeded 'client'/'co_client' keys — a literal-string check would wrongly
// exclude it.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import integrationRoutes from '../../../server/portal/integration.routes';
import { signM2mHeader, M2M_HEADER } from '../../../server/lib/m2m-auth';
import { PortalService } from '../../../server/services/portal.service';
import { PeopleService } from '../../../server/services/people.service';
import portalRoutes from '../../../server/api/portal';

const TENANT = '00000000-0000-0000-0000-0000000000d1';
// Custom, non-literal role key whose kind is 'client' — proves the filter is
// capability-derived rather than matching the literal strings 'client'/'co_client'.
const CUSTOM_CLIENT_KEY = 'primary_buyer';
// Custom kind='other' role — selfRetrieveReport is false by default.
const CUSTOM_OTHER_KEY = 'vendor';

async function seedCustomRoles(db: BetterSQLite3Database<typeof schema>, tenantId: string) {
    const now = new Date(1);
    await db.insert(schema.contactRoleProfiles).values([
        {
            id: `crp_${tenantId}_${CUSTOM_CLIENT_KEY}`, tenantId, key: CUSTOM_CLIENT_KEY,
            label: 'Primary Buyer', kind: 'client', isSystem: false, sortOrder: 90,
            active: true, createdAt: now, updatedAt: now,
        },
        {
            id: `crp_${tenantId}_${CUSTOM_OTHER_KEY}`, tenantId, key: CUSTOM_OTHER_KEY,
            label: 'Vendor', kind: 'other', isSystem: false, sortOrder: 100,
            active: true, createdAt: now, updatedAt: now,
        },
    ] as never);
}

// ---------------------------------------------------------------------------
// Site 1 — GET /api/integration/tenants/by-email (cross-tenant discovery)
// ---------------------------------------------------------------------------
describe('find-my-report discovery — capability-driven role filter', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    const FAKE_PEM = `-----BEGIN PRIVATE KEY-----\n${btoa('test-m2m-shared-key-material-0123456789')}\n-----END PRIVATE KEY-----`;
    const ENV = { DB: {}, JWT_CURRENT_KID: 'v1', JWT_PRIVATE_KEY_V1: FAKE_PEM } as Record<string, unknown>;

    function app() { const a = new OpenAPIHono<HonoConfig>(); a.route('/api/integration', integrationRoutes); return a; }
    async function header() { return signM2mHeader(ENV as Record<string, string | undefined>); }

    beforeEach(async () => {
        const s = createTestDb(); testDb = s.db; sqlite = s.sqlite; await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({ id: TENANT, name: 'Acme', slug: 'acme-cap', createdAt: new Date() } as never);
        await seedRoleProfiles(testDb, TENANT, new Date(1));
        await seedCustomRoles(testDb, TENANT);
        await testDb.insert(schema.inspectionAccessTokens).values([
            { id: 'g-client', tenantId: TENANT, inspectionId: 'i1', recipientEmail: 'jane@x.com', role: 'client', token: 'tok1', createdAt: new Date() },
            { id: 'g-agent', tenantId: TENANT, inspectionId: 'i2', recipientEmail: 'agent@x.com', role: 'buyer_agent', token: 'tok2', createdAt: new Date() },
            { id: 'g-other', tenantId: TENANT, inspectionId: 'i3', recipientEmail: 'vendor@x.com', role: CUSTOM_OTHER_KEY, token: 'tok3', createdAt: new Date() },
            { id: 'g-custom-client', tenantId: TENANT, inspectionId: 'i4', recipientEmail: 'buyer@x.com', role: CUSTOM_CLIENT_KEY, token: 'tok4', createdAt: new Date() },
        ] as never);
    });
    afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

    it('finds the tenant for a plain client-role grant', async () => {
        const res = await app().request('/api/integration/tenants/by-email?email=jane@x.com', { headers: { [M2M_HEADER]: await header() } }, ENV);
        const body = await res.json() as { data: { slugs: string[] } };
        expect(body.data.slugs).toEqual(['acme-cap']);
    });

    it('finds the tenant for an agent-kind grant (buyer_agent) — Spec 3 flip opened selfRetrieveReport for agents', async () => {
        const res = await app().request('/api/integration/tenants/by-email?email=agent@x.com', { headers: { [M2M_HEADER]: await header() } }, ENV);
        const body = await res.json() as { data: { slugs: string[] } };
        expect(body.data.slugs).toEqual(['acme-cap']);
    });

    it('does NOT find the tenant for a custom other-kind grant', async () => {
        const res = await app().request('/api/integration/tenants/by-email?email=vendor@x.com', { headers: { [M2M_HEADER]: await header() } }, ENV);
        const body = await res.json() as { data: { slugs: string[] } };
        expect(body.data.slugs).toEqual([]);
    });

    it('finds the tenant for a CUSTOM non-literal client-kind role key (capability-derived, not a hard-coded list)', async () => {
        const res = await app().request('/api/integration/tenants/by-email?email=buyer@x.com', { headers: { [M2M_HEADER]: await header() } }, ENV);
        const body = await res.json() as { data: { slugs: string[] } };
        expect(body.data.slugs).toEqual(['acme-cap']);
    });
});

// ---------------------------------------------------------------------------
// Site 2 — PortalService.listRecipientInspections (known-grant query)
// ---------------------------------------------------------------------------
describe('PortalService.listRecipientInspections — capability-driven role filter', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: PortalService;

    async function seedInsp(id: string) {
        await testDb.insert(schema.inspections).values({
            id, tenantId: TENANT, propertyAddress: `${id} Main St`, date: '2026-06-01',
            status: 'requested', reportStatus: 'in_progress', paymentStatus: 'unpaid', createdAt: new Date(),
        } as never);
    }
    async function seedTok(inspectionId: string, email: string, role: string) {
        await testDb.insert(schema.inspectionAccessTokens).values({
            id: crypto.randomUUID(), tenantId: TENANT, inspectionId, recipientEmail: email, role,
            token: crypto.randomUUID(), createdAt: new Date(), expiresAt: null, revokedAt: null,
        } as never);
    }

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme-cap2', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as never);
        await seedRoleProfiles(testDb, TENANT, new Date(1));
        await seedCustomRoles(testDb, TENANT);
        svc = new PortalService({} as D1Database, { getObserveProgress: async () => { throw new Error('unused in this suite'); } });
    });

    it('includes a client-role grant', async () => {
        await seedInsp('insp1'); await seedTok('insp1', 'a@x.com', 'client');
        const rows = await svc.listRecipientInspections(TENANT, 'a@x.com');
        expect(rows.map((r) => r.inspectionId)).toEqual(['insp1']);
    });

    it('includes an agent-kind grant (buyer_agent) — Spec 3 flip opened selfRetrieveReport for agents', async () => {
        await seedInsp('insp1'); await seedTok('insp1', 'a@x.com', 'buyer_agent');
        const rows = await svc.listRecipientInspections(TENANT, 'a@x.com');
        expect(rows.map((r) => r.inspectionId)).toEqual(['insp1']);
    });

    it('excludes a custom other-kind grant', async () => {
        await seedInsp('insp1'); await seedTok('insp1', 'a@x.com', CUSTOM_OTHER_KEY);
        const rows = await svc.listRecipientInspections(TENANT, 'a@x.com');
        expect(rows).toEqual([]);
    });

    it('includes a CUSTOM non-literal client-kind role key (capability-derived, not a hard-coded list)', async () => {
        await seedInsp('insp1'); await seedTok('insp1', 'a@x.com', CUSTOM_CLIENT_KEY);
        const rows = await svc.listRecipientInspections(TENANT, 'a@x.com');
        expect(rows.map((r) => r.inspectionId)).toEqual(['insp1']);
    });
});

// ---------------------------------------------------------------------------
// Site 3 — GET /api/portal/:tenant/exchange (hub exchange reject)
// ---------------------------------------------------------------------------
describe('GET /api/portal/:tenant/exchange — capability-driven role gate', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

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
            c.set('requestedTenantSlug', 'acme-cap3');
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
        await setupSchema(fix.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme-cap3', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as never);
        await seedRoleProfiles(testDb, TENANT, new Date(1));
        await seedCustomRoles(testDb, TENANT);
    });

    function reqEnv() { return { JWT_SECRET: 'test-jwt-secret' } as unknown as HonoConfig['Bindings']; }

    it('a client grant passes → 200', async () => {
        await seedInsp('insp1');
        const token = await seedTokReturning('insp1', 'a@x.com', 'client');
        const res = await buildApp().request(
            `/api/portal/acme-cap3/exchange?token=${encodeURIComponent(token)}&inspectionId=insp1`, {}, reqEnv());
        expect(res.status).toBe(200);
    });

    it('an agent-kind grant (buyer_agent) now passes the gate → 200 (Spec 3 flip; a KNOWN interaction — a later task routes agent tokens to magic-login instead of a client session)', async () => {
        await seedInsp('insp1');
        const token = await seedTokReturning('insp1', 'agent@x.com', 'buyer_agent');
        const res = await buildApp().request(
            `/api/portal/acme-cap3/exchange?token=${encodeURIComponent(token)}&inspectionId=insp1`, {}, reqEnv());
        expect(res.status).toBe(200);
    });

    it('a CUSTOM non-literal client-kind role key passes → 200 (capability-derived, not a hard-coded list)', async () => {
        await seedInsp('insp1');
        const token = await seedTokReturning('insp1', 'buyer@x.com', CUSTOM_CLIENT_KEY);
        const res = await buildApp().request(
            `/api/portal/acme-cap3/exchange?token=${encodeURIComponent(token)}&inspectionId=insp1`, {}, reqEnv());
        expect(res.status).toBe(200);
    });

    it('a custom other-kind role key is rejected → 403', async () => {
        await seedInsp('insp1');
        const token = await seedTokReturning('insp1', 'vendor@x.com', CUSTOM_OTHER_KEY);
        const res = await buildApp().request(
            `/api/portal/acme-cap3/exchange?token=${encodeURIComponent(token)}&inspectionId=insp1`, {}, reqEnv());
        expect(res.status).toBe(403);
    });
});
