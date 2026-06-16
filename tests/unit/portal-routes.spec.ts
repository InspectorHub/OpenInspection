import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PortalService } from '../../server/services/portal.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// PortalService builds its drizzle handle via `drizzle(this.db)` (drizzle-orm/d1).
// Mock that factory to hand back the in-memory better-sqlite3 test DB, mirroring
// the harness used by portal-access.spec.ts.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000a1';

// A stub InspectionService.getObserveProgress — the unit under test only sums
// totalItems/completedItems across the returned sections.
const inspStub = {
    getObserveProgress: async () => ({
        sections: [
            { totalItems: 5, completedItems: 2 },
            { totalItems: 3, completedItems: 3 },
        ],
    }),
};

describe('PortalService', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: PortalService;

    async function seedInspection(id: string, overrides: Partial<typeof schema.inspections.$inferInsert> = {}) {
        await testDb.insert(schema.inspections).values({
            id,
            tenantId: TENANT,
            propertyAddress: `${id} Main St`,
            date: '2026-06-01',
            status: 'requested',
            reportStatus: 'in_progress',
            paymentStatus: 'unpaid',
            createdAt: new Date(),
            ...overrides,
        });
    }

    async function seedToken(inspectionId: string, recipientEmail: string, role: 'client' | 'co_client' | 'agent', revokedAt: number | null = null, expiresAt: number | null = null) {
        await testDb.insert(schema.inspectionAccessTokens).values({
            id: crypto.randomUUID(),
            tenantId: TENANT,
            inspectionId,
            recipientEmail,
            role,
            token: crypto.randomUUID(),
            createdAt: Date.now(),
            expiresAt,
            revokedAt,
        });
    }

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        svc = new PortalService({} as D1Database, inspStub);
    });

    it('listRecipientInspections returns only this email + client/co_client roles, dedup, excludes revoked', async () => {
        for (const id of ['insp1', 'insp2', 'insp3', 'insp4', 'insp5']) await seedInspection(id);
        await seedToken('insp1', 'a@x.com', 'client');
        await seedToken('insp2', 'a@x.com', 'co_client');
        await seedToken('insp3', 'a@x.com', 'agent');       // excluded — agent role
        await seedToken('insp4', 'b@x.com', 'client');      // excluded — other email
        await seedToken('insp5', 'a@x.com', 'client', 1);   // excluded — revoked

        const rows = await svc.listRecipientInspections(TENANT, 'a@x.com');
        const ids = rows.map((r) => r.inspectionId).sort();
        expect(ids).toEqual(['insp1', 'insp2']);
    });

    it('listRecipientInspections enforces expiresAt: excludes past-expiry, includes future-expiry and null-expiry', async () => {
        for (const id of ['inspNull', 'inspFuture', 'inspPast']) await seedInspection(id);
        const past = Date.now() - 60_000;   // expired one minute ago
        const future = Date.now() + 60_000; // expires one minute from now
        await seedToken('inspNull', 'a@x.com', 'client', null, null);     // never expires → included
        await seedToken('inspFuture', 'a@x.com', 'client', null, future); // not yet expired → included
        await seedToken('inspPast', 'a@x.com', 'client', null, past);     // expired → excluded

        const rows = await svc.listRecipientInspections(TENANT, 'a@x.com');
        const ids = rows.map((r) => r.inspectionId).sort();
        expect(ids).toEqual(['inspFuture', 'inspNull']);
    });

    it('listRecipientInspections returns [] when the recipient has no live tokens', async () => {
        await seedInspection('insp1');
        await seedToken('insp1', 'someone@x.com', 'client');
        expect(await svc.listRecipientInspections(TENANT, 'nobody@x.com')).toEqual([]);
    });

    it('hubOverview returns the 6 status dimensions', async () => {
        await seedInspection('insp1', { reportStatus: 'published', paymentStatus: 'paid' });
        const agreementId = crypto.randomUUID();
        await testDb.insert(schema.agreements).values({
            id: agreementId, tenantId: TENANT, name: 'A', content: 'terms', createdAt: new Date(),
        });
        await testDb.insert(schema.agreementRequests).values({
            id: crypto.randomUUID(), tenantId: TENANT, inspectionId: 'insp1',
            agreementId, clientEmail: 'a@x.com',
            token: crypto.randomUUID(), status: 'signed', createdAt: new Date(),
        });
        await testDb.insert(schema.customerMessages).values([
            { id: crypto.randomUUID(), tenantId: TENANT, inspectionId: 'insp1', fromRole: 'inspector', body: 'hi', readAt: null, createdAt: Date.now() },
            { id: crypto.randomUUID(), tenantId: TENANT, inspectionId: 'insp1', fromRole: 'inspector', body: 'read', readAt: Date.now(), createdAt: Date.now() },
            { id: crypto.randomUUID(), tenantId: TENANT, inspectionId: 'insp1', fromRole: 'client', body: 'mine', readAt: null, createdAt: Date.now() },
        ]);

        const ov = await svc.hubOverview(TENANT, 'insp1');
        expect(ov).toMatchObject({
            inspectionStatus: expect.any(String),
            agreementSigned: true,
            paymentStatus: 'paid',
            reportPublished: true,
            progress: expect.objectContaining({ completed: 5, total: 8 }),
            unreadMessages: 1,
        });
    });

    it('hubOverview falls back to {completed:0,total:0} when progress build throws', async () => {
        await seedInspection('insp1');
        const throwingSvc = new PortalService({} as D1Database, {
            getObserveProgress: async () => { throw new Error('no report'); },
        });
        const ov = await throwingSvc.hubOverview(TENANT, 'insp1');
        expect(ov?.progress).toEqual({ completed: 0, total: 0 });
    });

    it('hubOverview returns null for an unknown inspection', async () => {
        expect(await svc.hubOverview(TENANT, 'nope')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Task 3 — portal API routes + session middleware
// ---------------------------------------------------------------------------
import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../server/types/hono';
import { signPortalSession, signMagicLink } from '../../server/lib/portal-session';
// eslint-disable-next-line import/order
import portalRoutes from '../../server/api/portal';

const SECRET = 'test-jwt-secret';

describe('portal API', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sendEmail: ReturnType<typeof vi.fn>;

    async function seedInspection(id: string, overrides: Partial<typeof schema.inspections.$inferInsert> = {}) {
        await testDb.insert(schema.inspections).values({
            id,
            tenantId: TENANT,
            propertyAddress: `${id} Main St`,
            date: '2026-06-01',
            status: 'requested',
            reportStatus: 'in_progress',
            paymentStatus: 'unpaid',
            createdAt: new Date(),
            ...overrides,
        });
    }

    async function seedToken(inspectionId: string, recipientEmail: string, role: 'client' | 'co_client' | 'agent' = 'client', revokedAt: number | null = null) {
        await testDb.insert(schema.inspectionAccessTokens).values({
            id: crypto.randomUUID(),
            tenantId: TENANT,
            inspectionId,
            recipientEmail,
            role,
            token: crypto.randomUUID(),
            createdAt: Date.now(),
            expiresAt: null,
            revokedAt,
        });
    }

    function buildApp(tenantId: string | null = TENANT) {
        const portalSvc = new PortalService({} as D1Database, inspStub);
        sendEmail = vi.fn().mockResolvedValue({ delivered: true });
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            if (tenantId) {
                c.set('tenantId', tenantId);
                c.set('requestedTenantSlug', 'acme');
            }
            c.set('services', {
                portal: portalSvc,
                email: { sendEmail },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/portal', portalRoutes);
        return app;
    }

    // JWT_SECRET is injected via the env arg to app.request().
    function reqEnv() {
        return { JWT_SECRET: SECRET, APP_BASE_URL: 'https://example.test' } as unknown as HonoConfig['Bindings'];
    }

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
    });

    it('POST /request-link returns 200 for a known recipient and sends an email', async () => {
        await seedInspection('insp1');
        await seedToken('insp1', 'a@x.com', 'client');
        const app = buildApp();
        const res = await app.request('/api/portal/acme/request-link', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'a@x.com' }),
        }, reqEnv());
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.sent).toBe(true);
        expect(sendEmail).toHaveBeenCalledTimes(1);
        const htmlArg = sendEmail.mock.calls[0][2] as string;
        expect(htmlArg).toContain('/portal/acme/auth?link=');
    });

    it('POST /request-link returns 200 for an UNKNOWN email and does NOT send (no enumeration)', async () => {
        await seedInspection('insp1');
        await seedToken('insp1', 'a@x.com', 'client');
        const app = buildApp();
        const res = await app.request('/api/portal/acme/request-link', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'nobody@x.com' }),
        }, reqEnv());
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.sent).toBe(true);
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('POST /request-link returns 404 when the tenant slug is unresolved', async () => {
        const app = buildApp(null);
        const res = await app.request('/api/portal/nope/request-link', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'a@x.com' }),
        }, reqEnv());
        expect(res.status).toBe(404);
    });

    it('GET /redeem validates the magic link → 200 with email; bad token → 401', async () => {
        const app = buildApp();
        const token = await signMagicLink(SECRET, 'a@x.com');
        const ok = await app.request(`/api/portal/acme/redeem?link=${encodeURIComponent(token)}`, {}, reqEnv());
        expect(ok.status).toBe(200);
        expect((await ok.json()).data.email).toBe('a@x.com');

        const bad = await app.request('/api/portal/acme/redeem?link=garbage', {}, reqEnv());
        expect(bad.status).toBe(401);
    });

    it('GET /me without a session cookie → 401', async () => {
        const app = buildApp();
        const res = await app.request('/api/portal/acme/me', {}, reqEnv());
        expect(res.status).toBe(401);
    });

    it('GET /me with a valid session cookie → data.inspections populated', async () => {
        await seedInspection('insp1');
        await seedToken('insp1', 'a@x.com', 'client');
        const app = buildApp();
        const cookie = await signPortalSession(SECRET, 'a@x.com');
        const res = await app.request('/api/portal/acme/me', {
            headers: { cookie: '__Host-portal_session=' + cookie },
        }, reqEnv());
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.data.email).toBe('a@x.com');
        expect(json.data.inspections.length).toBeGreaterThan(0);
    });

    it('GET /inspections/:id/overview → 200 for an owned inspection', async () => {
        await seedInspection('insp1');
        await seedToken('insp1', 'a@x.com', 'client');
        const app = buildApp();
        const cookie = await signPortalSession(SECRET, 'a@x.com');
        const res = await app.request('/api/portal/acme/inspections/insp1/overview', {
            headers: { cookie: '__Host-portal_session=' + cookie },
        }, reqEnv());
        expect(res.status).toBe(200);
        expect((await res.json()).data.address).toContain('insp1');
    });

    it('GET /inspections/:id/overview → 403 for an inspection the email does NOT own', async () => {
        await seedInspection('insp1');
        await seedInspection('insp2');
        await seedToken('insp1', 'a@x.com', 'client');
        await seedToken('insp2', 'other@x.com', 'client');
        const app = buildApp();
        const cookie = await signPortalSession(SECRET, 'a@x.com');
        const res = await app.request('/api/portal/acme/inspections/insp2/overview', {
            headers: { cookie: '__Host-portal_session=' + cookie },
        }, reqEnv());
        expect(res.status).toBe(403);
    });
});
