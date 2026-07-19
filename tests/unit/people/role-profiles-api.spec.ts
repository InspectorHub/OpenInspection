/**
 * /api/role-profiles CRUD API tests — Plan 1B Task 2.
 *
 * Test setup copied from: tests/unit/email/email-templates-api.spec.ts
 * (OpenAPIHono + HonoConfig, vi.mock('drizzle-orm/d1') → better-sqlite3
 * in-memory) and tests/unit/bookings/booking-people.spec.ts (real service
 * instance wired onto c.var.services, onError mapping AppError -> status).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { AppError } from '../../../server/lib/errors';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import roleProfilesRoutes from '../../../server/api/role-profiles';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

function buildApp(userRole: string = 'owner') {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('userRole', userRole as HonoConfig['Variables']['userRole']);
        c.set('tenantId', TENANT_ID);
        c.set('services', { people: new PeopleService({ DB: {} as D1Database }) } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/role-profiles', roleProfilesRoutes);
    return app;
}

describe('/api/role-profiles', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);

        await testDb.insert(schema.tenants).values({
            id: TENANT_ID, name: 'Test Tenant', slug: 'test', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(testDb, TENANT_ID, new Date(1));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('GET / lists the seeded system profiles', async () => {
        const app = buildApp();
        const res = await app.request('/api/role-profiles', {}, { DB: {} });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: Array<{ key: string; isSystem: boolean }> };
        expect(body.success).toBe(true);
        expect(body.data.length).toBeGreaterThan(0);
        expect(body.data.every(p => p.isSystem)).toBe(true);
    });

    it('POST / creates a tenant-defined profile, then GET / shows it', async () => {
        const app = buildApp();
        const createRes = await app.request('/api/role-profiles', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ label: 'Property Manager', kind: 'other' }),
        }, { DB: {} });
        expect(createRes.status).toBe(201);
        const createBody = await createRes.json() as { success: boolean; data: { id: string; key: string; label: string; isSystem: boolean } };
        expect(createBody.success).toBe(true);
        expect(createBody.data.label).toBe('Property Manager');
        expect(createBody.data.key).toBe('property_manager');
        expect(createBody.data.isSystem).toBe(false);

        const listRes = await app.request('/api/role-profiles', {}, { DB: {} });
        const listBody = await listRes.json() as { success: boolean; data: Array<{ id: string; label: string }> };
        expect(listBody.data.some(p => p.id === createBody.data.id && p.label === 'Property Manager')).toBe(true);
    });

    it('PUT /:id changes the label', async () => {
        const app = buildApp();
        const createRes = await app.request('/api/role-profiles', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ label: 'Lender', kind: 'other' }),
        }, { DB: {} });
        const { data: created } = await createRes.json() as { data: { id: string } };

        const putRes = await app.request(`/api/role-profiles/${created.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ label: 'Mortgage Lender' }),
        }, { DB: {} });
        expect(putRes.status).toBe(200);
        const putBody = await putRes.json() as { success: boolean; data: { updated: boolean } };
        expect(putBody.success).toBe(true);
        expect(putBody.data.updated).toBe(true);

        const listRes = await app.request('/api/role-profiles', {}, { DB: {} });
        const listBody = await listRes.json() as { data: Array<{ id: string; label: string }> };
        expect(listBody.data.find(p => p.id === created.id)?.label).toBe('Mortgage Lender');
    });

    it('DELETE /:id soft-deactivates a tenant-defined profile', async () => {
        const app = buildApp();
        const createRes = await app.request('/api/role-profiles', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ label: 'Surveyor', kind: 'other' }),
        }, { DB: {} });
        const { data: created } = await createRes.json() as { data: { id: string } };

        const delRes = await app.request(`/api/role-profiles/${created.id}`, { method: 'DELETE' }, { DB: {} });
        expect(delRes.status).toBe(200);
        const delBody = await delRes.json() as { success: boolean; data: { deactivated: boolean } };
        expect(delBody.success).toBe(true);
        expect(delBody.data.deactivated).toBe(true);

        const listRes = await app.request('/api/role-profiles', {}, { DB: {} });
        const listBody = await listRes.json() as { data: Array<{ id: string; active: boolean }> };
        expect(listBody.data.find(p => p.id === created.id)?.active).toBe(false);
    });

    it('DELETE /:id on an isSystem profile returns 409', async () => {
        const app = buildApp();
        const listRes = await app.request('/api/role-profiles', {}, { DB: {} });
        const listBody = await listRes.json() as { data: Array<{ id: string; isSystem: boolean }> };
        const systemProfile = listBody.data.find(p => p.isSystem);
        expect(systemProfile).toBeTruthy();

        const delRes = await app.request(`/api/role-profiles/${systemProfile!.id}`, { method: 'DELETE' }, { DB: {} });
        expect(delRes.status).toBe(409);
        const delBody = await delRes.json() as { success: boolean; error: { code: string } };
        expect(delBody.success).toBe(false);
        expect(delBody.error.code).toBe('conflict');
    });

    it('PUT /:id with active:false on an isSystem profile returns 409', async () => {
        const app = buildApp();
        const listRes = await app.request('/api/role-profiles', {}, { DB: {} });
        const listBody = await listRes.json() as { data: Array<{ id: string; isSystem: boolean }> };
        const systemProfile = listBody.data.find(p => p.isSystem);

        const putRes = await app.request(`/api/role-profiles/${systemProfile!.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ active: false }),
        }, { DB: {} });
        expect(putRes.status).toBe(409);
    });

    it('allows inspector role to GET (list) role profiles', async () => {
        const app = buildApp('inspector');
        const res = await app.request('/api/role-profiles', {}, { DB: {} });
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: Array<{ key: string; isSystem: boolean }> };
        expect(body.success).toBe(true);
        expect(body.data.length).toBeGreaterThan(0);
        expect(body.data.every(p => p.isSystem)).toBe(true);
    });

    it('rejects POST (create) from inspector role with 403', async () => {
        const app = buildApp('inspector');
        const res = await app.request('/api/role-profiles', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ label: 'Blocked', kind: 'other' }),
        }, { DB: {} });
        expect(res.status).toBe(403);
    });

    it('rejects PUT (update) from inspector role with 403', async () => {
        // First, create a profile as owner to get an ID
        const ownerApp = buildApp('owner');
        const createRes = await ownerApp.request('/api/role-profiles', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ label: 'Test Profile', kind: 'other' }),
        }, { DB: {} });
        const { data: created } = await createRes.json() as { data: { id: string } };

        // Now try to update as inspector
        const inspectorApp = buildApp('inspector');
        const putRes = await inspectorApp.request(`/api/role-profiles/${created.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ label: 'Updated' }),
        }, { DB: {} });
        expect(putRes.status).toBe(403);
    });

    it('rejects DELETE (deactivate) from inspector role with 403', async () => {
        // First, create a profile as owner to get an ID
        const ownerApp = buildApp('owner');
        const createRes = await ownerApp.request('/api/role-profiles', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ label: 'Test Profile', kind: 'other' }),
        }, { DB: {} });
        const { data: created } = await createRes.json() as { data: { id: string } };

        // Now try to delete as inspector
        const inspectorApp = buildApp('inspector');
        const delRes = await inspectorApp.request(`/api/role-profiles/${created.id}`, {
            method: 'DELETE',
        }, { DB: {} });
        expect(delRes.status).toBe(403);
    });
});
