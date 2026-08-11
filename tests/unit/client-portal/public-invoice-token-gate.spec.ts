import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// PortalAccessService builds its drizzle handle via `drizzle(this.db)`
// (drizzle-orm/d1). Mock that factory to hand back the in-memory better-sqlite3
// test DB (mirrors client-document-routes.spec.ts).
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';
import { PortalAccessService } from '../../../server/services/portal-access.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { signPortalSession } from '../../../server/lib/portal-session';
import publicReportRoutes from '../../../server/api/public-report';

/**
 * IA-34 — `GET /api/public/inspections/:id/invoice` and
 * `POST /api/public/inspections/:id/pay-intent` used to accept ANY caller who
 * knew the inspection id ("the unguessable id is the key"). Both now run the
 * same `resolveClientActor` gate the documents/messages routes use: a live
 * `?token=` portal grant for THIS inspection, or the `__Host-portal_session`
 * cookie, and only for client / co_client role kinds.
 *
 * Every assertion here is on the HTTP STATUS CODE — a page-level redirect or a
 * client-side bounce would not prove the server refused.
 */

const TENANT = '00000000-0000-0000-0000-0000000000a1';
const OTHER_TENANT = '00000000-0000-0000-0000-0000000000a2';
const SECRET = 'test-jwt-secret';
const INSP = 'insp-ia34-1';
const OTHER_INSP = 'insp-ia34-2';

describe('IA-34 — public invoice + pay-intent token gate', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let portalAccess: PortalAccessService;
    let findByInspectionId: ReturnType<typeof vi.fn>;

    function buildApp(env: Record<string, unknown> = {}, routedTenantId: string | null = TENANT) {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            (c as unknown as { env: Record<string, unknown> }).env = {
                DB: {}, JWT_SECRET: SECRET, ...env,
            };
            // What the tenant-by-inspection-id router resolves in production.
            // Tests pass null / a foreign id to prove the handlers trust the
            // GRANT's tenantId rather than the routed one.
            if (routedTenantId) c.set('resolvedTenantId', routedTenantId as never);
            c.set('services', {
                portalAccess,
                invoice: { findByInspectionId },
                branding: { getBrand: vi.fn().mockResolvedValue({ companyName: 'Acme', logoUrl: null, primaryColor: null, defaultTimezone: 'UTC' }) },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/public', publicReportRoutes);
        return app;
    }

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(asD1Db(testDb), TENANT);
        portalAccess = new PortalAccessService({} as D1Database, { jwtSecret: SECRET });
        findByInspectionId = vi.fn().mockImplementation(async (tenantId: string, id: string) =>
            tenantId === TENANT && id === INSP
                ? { id: 'inv-1', inspectionId: INSP, amountCents: 5000, currency: 'USD', status: 'sent', paidAt: null, lineItems: [] }
                : null,
        );
    });

    const issue = (email: string, role: string, inspectionId = INSP) =>
        portalAccess.issueToken({ tenantId: TENANT, inspectionId, recipientEmail: email, role });

    /* ---------------- GET invoice ---------------- */

    it('GET invoice — 401 with NO token and NO session (was 200: "the unguessable id is the key")', async () => {
        const res = await buildApp().request(`/api/public/inspections/${INSP}/invoice`);
        expect(res.status).toBe(401);
    });

    it('GET invoice — 200 for a client token, and the query uses the TOKEN tenantId', async () => {
        const token = await issue('client@x.com', 'client');
        // routedTenantId=null: the handler must no longer depend on the routed
        // tenant at all — the grant row is the authority.
        const res = await buildApp({}, null).request(`/api/public/inspections/${INSP}/invoice?token=${token}`);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { id: string } | null };
        expect(body.data?.id).toBe('inv-1');
        expect(findByInspectionId).toHaveBeenCalledWith(TENANT, INSP);
    });

    it('GET invoice — 200 for a co_client token', async () => {
        const token = await issue('spouse@x.com', 'co_client');
        const res = await buildApp().request(`/api/public/inspections/${INSP}/invoice?token=${token}`);
        expect(res.status).toBe(200);
    });

    it('GET invoice — 401 for an AGENT-kind token (agents are not clients here)', async () => {
        const token = await issue('agent@x.com', 'buyer_agent');
        const res = await buildApp().request(`/api/public/inspections/${INSP}/invoice?token=${token}`);
        expect(res.status).toBe(401);
    });

    it('GET invoice — 401 when the token grants a DIFFERENT inspection', async () => {
        const token = await issue('client@x.com', 'client', OTHER_INSP);
        const res = await buildApp().request(`/api/public/inspections/${INSP}/invoice?token=${token}`);
        expect(res.status).toBe(401);
    });

    it('GET invoice — 401 once the token is revoked', async () => {
        const token = await issue('client@x.com', 'client');
        await portalAccess.revokeForRecipient(TENANT, INSP, 'client@x.com');
        const res = await buildApp().request(`/api/public/inspections/${INSP}/invoice?token=${token}`);
        expect(res.status).toBe(401);
    });

    it('GET invoice — 200 via the __Host-portal_session cookie (no ?token)', async () => {
        await issue('client@x.com', 'client');
        const cookie = await signPortalSession(SECRET, 'client@x.com');
        const res = await buildApp().request(`/api/public/inspections/${INSP}/invoice`, {
            headers: { cookie: '__Host-portal_session=' + cookie },
        });
        expect(res.status).toBe(200);
    });

    /* ---------------- POST pay-intent ---------------- */

    it('POST pay-intent — 401 with NO token (the gate runs BEFORE the Stripe-config check)', async () => {
        const res = await buildApp({ STRIPE_SECRET_KEY: 'sk_test', STRIPE_PUBLISHABLE_KEY: 'pk_test' })
            .request(`/api/public/inspections/${INSP}/pay-intent`, { method: 'POST' });
        expect(res.status).toBe(401);
    });

    it('POST pay-intent — 401 for an agent-kind token', async () => {
        const token = await issue('agent@x.com', 'buyer_agent');
        const res = await buildApp({ STRIPE_SECRET_KEY: 'sk_test', STRIPE_PUBLISHABLE_KEY: 'pk_test' })
            .request(`/api/public/inspections/${INSP}/pay-intent?token=${token}`, { method: 'POST' });
        expect(res.status).toBe(401);
    });

    it('POST pay-intent — an authorized client passes the gate (503 unconfigured-Stripe, NOT 401)', async () => {
        const token = await issue('client@x.com', 'client');
        const res = await buildApp()
            .request(`/api/public/inspections/${INSP}/pay-intent?token=${token}`, { method: 'POST' });
        expect(res.status).toBe(503);
    });

    it('POST pay-intent — 401 when the ROUTED tenant (whose Stripe keys c.env carries) disagrees with the grant', async () => {
        const token = await issue('client@x.com', 'client');
        const res = await buildApp({ STRIPE_SECRET_KEY: 'sk_test', STRIPE_PUBLISHABLE_KEY: 'pk_test' }, OTHER_TENANT)
            .request(`/api/public/inspections/${INSP}/pay-intent?token=${token}`, { method: 'POST' });
        expect(res.status).toBe(401);
    });
});
