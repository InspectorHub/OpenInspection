import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// MessageService + PortalAccessService both build their drizzle handle via
// `drizzle(this.db)` (drizzle-orm/d1). Mock that factory to hand back the
// in-memory better-sqlite3 test DB (mirrors client-document-routes.spec.ts).
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import { Hono } from 'hono';
import type { HonoConfig } from '../../server/types/hono';
import { MessageService } from '../../server/services/message.service';
import { PortalAccessService } from '../../server/services/portal-access.service';
import { signPortalSession } from '../../server/lib/portal-session';
import { createApiRouter } from '../../server/lib/openapi-router';
import { clientMessageRoutes, inspectorMessageRoutes } from '../../server/api/messages';

const TENANT = '00000000-0000-0000-0000-0000000000a1';
const SECRET = 'test-jwt-secret';
const INSPECTOR_USER = 'inspector-user-1';

describe('client message routes (resolveClientActor-gated)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    function buildApp(portalAccess: PortalAccessService, message: MessageService) {
        // Parent must be an OpenAPIHono (createApiRouter) so the OpenAPIHono
        // inspector sub-router dispatches correctly when mounted via .route().
        const app = createApiRouter();
        const services = {
            portalAccess,
            message,
            // email is only invoked best-effort inside the send handler; a
            // throwing stub is swallowed by the route's try/catch.
            email: { sendMessageNotification: async () => { throw new Error('no email in test'); } },
            // portalAccess.issueToken is also used by the inspector send route to
            // build the client deep-link (best-effort, swallowed on failure).
        } as unknown as HonoConfig['Variables']['services'];
        app.use('*', async (c, next) => {
            c.set('services', services);
            await next();
        });
        // Authed inspector surface — inject the JWT context contract the global
        // jwtAuthMiddleware would set in production.
        app.use('/api/inspections/*', async (c, next) => {
            c.set('tenantId', TENANT);
            c.set('userRole', 'inspector');
            c.set('user', { sub: INSPECTOR_USER, role: 'inspector', tenantId: TENANT } as never);
            await next();
        });
        app.route('/api/public', clientMessageRoutes);
        app.route('/api/inspections', inspectorMessageRoutes);
        return app;
    }

    function reqEnv() {
        return { JWT_SECRET: SECRET, DB: {} as D1Database } as unknown as HonoConfig['Bindings'];
    }

    async function seed() {
        const inspectionId = 'insp1';
        await testDb.insert(schema.inspections).values({
            id: inspectionId, tenantId: TENANT, propertyAddress: '1 Main St', date: '2026-06-01',
            status: 'requested', reportStatus: 'in_progress', paymentStatus: 'unpaid',
            clientName: 'Pat Client', clientEmail: 'client@x.com', createdAt: new Date(), price: 0,
        });
        const portalAccess = new PortalAccessService({} as D1Database, { jwtSecret: SECRET });
        const clientEmail = 'client@x.com';
        const clientToken = await portalAccess.issueToken({
            tenantId: TENANT, inspectionId, recipientEmail: clientEmail, role: 'client',
        });
        const message = new MessageService({} as D1Database);
        const app = buildApp(portalAccess, message);
        return { app, inspectionId, clientToken, clientEmail, portalAccess, message };
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

    it('GET list: 401 without auth, 200 with token', async () => {
        const { app, inspectionId, clientToken } = await seed();
        const noTok = await app.request(`/api/public/inspections/${inspectionId}/messages`, {}, reqEnv());
        expect(noTok.status).toBe(401);
        const ok = await app.request(`/api/public/inspections/${inspectionId}/messages?token=${clientToken}`, {}, reqEnv());
        expect(ok.status).toBe(200);
        const body = await ok.json();
        expect(body.success).toBe(true);
        expect(Array.isArray(body.data)).toBe(true);
    });

    it('POST send (token): creates a client message attributed to the inspection client name', async () => {
        const { app, inspectionId, clientToken, message } = await seed();
        const res = await app.request(`/api/public/inspections/${inspectionId}/messages?token=${clientToken}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ body: 'Hello from the client' }),
        }, reqEnv());
        expect(res.status).toBe(201);
        const list = await message.listForInspection(inspectionId, TENANT);
        expect(list).toHaveLength(1);
        expect(list[0].fromRole).toBe('client');
        expect(list[0].fromName).toBe('Pat Client');
        expect(list[0].body).toBe('Hello from the client');
    });

    it('POST send: 401 without auth; 400 on empty body', async () => {
        const { app, inspectionId, clientToken } = await seed();
        const unauth = await app.request(`/api/public/inspections/${inspectionId}/messages`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'x' }),
        }, reqEnv());
        expect(unauth.status).toBe(401);
        const bad = await app.request(`/api/public/inspections/${inspectionId}/messages?token=${clientToken}`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: '' }),
        }, reqEnv());
        expect(bad.status).toBe(400);
    });

    it('SESSION cookie path: GET list authorizes via resolveByEmailAndInspection', async () => {
        const { app, inspectionId, clientEmail } = await seed();
        const cookie = await signPortalSession(SECRET, clientEmail);
        const res = await app.request(`/api/public/inspections/${inspectionId}/messages`, {
            headers: { cookie: '__Host-portal_session=' + cookie },
        }, reqEnv());
        expect(res.status).toBe(200);
    });

    it('a token for a DIFFERENT inspection cannot read this inspection (resolveClientActor scoping)', async () => {
        const { app, inspectionId, portalAccess } = await seed();
        // Seed a second inspection + a token for it; that token must not read insp1.
        await testDb.insert(schema.inspections).values({
            id: 'insp2', tenantId: TENANT, propertyAddress: '2 Main St', date: '2026-06-02',
            status: 'requested', reportStatus: 'in_progress', paymentStatus: 'unpaid',
            clientName: 'Other', clientEmail: 'other@x.com', createdAt: new Date(), price: 0,
        });
        const otherToken = await portalAccess.issueToken({
            tenantId: TENANT, inspectionId: 'insp2', recipientEmail: 'other@x.com', role: 'client',
        });
        const res = await app.request(`/api/public/inspections/${inspectionId}/messages?token=${otherToken}`, {}, reqEnv());
        expect(res.status).toBe(401);
    });

    it('client message is visible to the inspector via the authed route, scoped by inspection', async () => {
        const { app, inspectionId, clientToken } = await seed();
        await app.request(`/api/public/inspections/${inspectionId}/messages?token=${clientToken}`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'ping' }),
        }, reqEnv());
        const inspRes = await app.request(`/api/inspections/${inspectionId}/messages`, {}, reqEnv());
        expect(inspRes.status).toBe(200);
        const body = await inspRes.json();
        expect(body.data.length).toBe(1);
        expect(body.data[0].body).toBe('ping');
    });
});
