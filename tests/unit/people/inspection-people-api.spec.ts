/**
 * /api/inspections/:id/people list/add/remove API tests — Plan 1B Task 3.
 *
 * Test setup mirrors tests/unit/people/role-profiles-api.spec.ts (OpenAPIHono
 * + HonoConfig, vi.mock('drizzle-orm/d1') -> better-sqlite3 in-memory, real
 * PeopleService wired onto c.var.services, onError mapping AppError ->
 * status).
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
import { eq, and } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import peopleRoutes from '../../../server/api/inspections/people';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000002';
const INSPECTION_ID = 'insp-1';

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
        c.set('services', { people: new PeopleService({ DB: {} as D1Database } as unknown as { DB: D1Database }) } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/inspections', peopleRoutes);
    return app;
}

describe('/api/inspections/:id/people', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;
    let clientRoleProfileId: string;
    let coClientRoleProfileId: string;
    let buyerContactId: string;
    let coBuyerContactId: string;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);

        await testDb.insert(schema.tenants).values([
            { id: TENANT_ID, name: 'Test Tenant', slug: 'test', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: OTHER_TENANT_ID, name: 'Other Tenant', slug: 'other', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ] as never);
        await seedRoleProfiles(testDb, TENANT_ID, new Date(1));
        await seedRoleProfiles(testDb, OTHER_TENANT_ID, new Date(1));

        await testDb.insert(schema.inspections).values({
            id: INSPECTION_ID, tenantId: TENANT_ID, propertyAddress: '1 Main St', date: '2026-07-20',
            status: 'confirmed', paymentStatus: 'paid', price: 0, createdAt: new Date(1),
        } as never);

        buyerContactId = 'contact-buyer';
        coBuyerContactId = 'contact-co-buyer';
        await testDb.insert(schema.contacts).values([
            { id: buyerContactId, tenantId: TENANT_ID, type: 'client', name: 'Buyer', email: 'buyer@x.com', createdAt: new Date(1) },
            { id: coBuyerContactId, tenantId: TENANT_ID, type: 'client', name: 'Co-Buyer', email: 'cobuyer@x.com', createdAt: new Date(1) },
            // Cross-tenant contact — belongs to OTHER_TENANT_ID, never TENANT_ID.
            { id: 'contact-foreign', tenantId: OTHER_TENANT_ID, type: 'client', name: 'Foreign', email: 'foreign@x.com', createdAt: new Date(1) },
        ] as never);

        const clientProfile = await testDb.select().from(schema.contactRoleProfiles)
            .where(and(eq(schema.contactRoleProfiles.tenantId, TENANT_ID), eq(schema.contactRoleProfiles.key, 'client'))).get();
        const coClientProfile = await testDb.select().from(schema.contactRoleProfiles)
            .where(and(eq(schema.contactRoleProfiles.tenantId, TENANT_ID), eq(schema.contactRoleProfiles.key, 'co_client'))).get();
        clientRoleProfileId = clientProfile!.id;
        coClientRoleProfileId = coClientProfile!.id;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('POST adds a client person, then GET lists it', async () => {
        const app = buildApp();
        const postRes = await app.request(`/api/inspections/${INSPECTION_ID}/people`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ contactId: buyerContactId, roleProfileId: clientRoleProfileId }),
        }, { DB: {} });
        expect(postRes.status).toBe(201);

        const getRes = await app.request(`/api/inspections/${INSPECTION_ID}/people`, {}, { DB: {} });
        expect(getRes.status).toBe(200);
        const body = await getRes.json() as { success: boolean; data: Array<{ contactId: string; roleKey: string }> };
        expect(body.success).toBe(true);
        expect(body.data.some(p => p.contactId === buyerContactId && p.roleKey === 'client')).toBe(true);
    });

    it('POST a second client-role person returns 409', async () => {
        const app = buildApp();
        await app.request(`/api/inspections/${INSPECTION_ID}/people`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ contactId: buyerContactId, roleProfileId: clientRoleProfileId }),
        }, { DB: {} });

        const secondRes = await app.request(`/api/inspections/${INSPECTION_ID}/people`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ contactId: coBuyerContactId, roleProfileId: clientRoleProfileId }),
        }, { DB: {} });
        expect(secondRes.status).toBe(409);
        const body = await secondRes.json() as { success: boolean; error: { code: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('conflict');
    });

    it('POST a co_client person returns 200/201 (unrestricted alongside a primary client)', async () => {
        const app = buildApp();
        await app.request(`/api/inspections/${INSPECTION_ID}/people`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ contactId: buyerContactId, roleProfileId: clientRoleProfileId }),
        }, { DB: {} });

        const coRes = await app.request(`/api/inspections/${INSPECTION_ID}/people`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ contactId: coBuyerContactId, roleProfileId: coClientRoleProfileId }),
        }, { DB: {} });
        expect(coRes.status).toBe(201);

        const getRes = await app.request(`/api/inspections/${INSPECTION_ID}/people`, {}, { DB: {} });
        const body = await getRes.json() as { success: boolean; data: Array<{ contactId: string; roleKey: string }> };
        expect(body.data.some(p => p.contactId === coBuyerContactId && p.roleKey === 'co_client')).toBe(true);
    });

    it('DELETE removes a person', async () => {
        const app = buildApp();
        await app.request(`/api/inspections/${INSPECTION_ID}/people`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ contactId: buyerContactId, roleProfileId: clientRoleProfileId }),
        }, { DB: {} });

        const listRes = await app.request(`/api/inspections/${INSPECTION_ID}/people`, {}, { DB: {} });
        const listBody = await listRes.json() as { data: Array<{ id: string; contactId: string }> };
        const row = listBody.data.find(p => p.contactId === buyerContactId);
        expect(row).toBeTruthy();

        const delRes = await app.request(`/api/inspections/${INSPECTION_ID}/people/${row!.id}`, { method: 'DELETE' }, { DB: {} });
        expect(delRes.status).toBe(200);

        const afterRes = await app.request(`/api/inspections/${INSPECTION_ID}/people`, {}, { DB: {} });
        const afterBody = await afterRes.json() as { data: Array<{ id: string }> };
        expect(afterBody.data.find(p => p.id === row!.id)).toBeUndefined();
    });

    it('POST with a cross-tenant contactId returns 404 (tenant-ownership gap closed)', async () => {
        const app = buildApp();
        const res = await app.request(`/api/inspections/${INSPECTION_ID}/people`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ contactId: 'contact-foreign', roleProfileId: clientRoleProfileId }),
        }, { DB: {} });
        expect(res.status).toBe(404);

        // Also prove nothing was inserted (defense-in-depth check, not just the status code).
        const rows = await testDb.select().from(schema.inspectionPeople)
            .where(eq(schema.inspectionPeople.inspectionId, INSPECTION_ID));
        expect(rows).toHaveLength(0);
    });

    it('rejects writes from a non-privileged role... actually inspector IS allowed (normal action, not admin-gated)', async () => {
        const app = buildApp('inspector');
        const res = await app.request(`/api/inspections/${INSPECTION_ID}/people`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ contactId: buyerContactId, roleProfileId: clientRoleProfileId }),
        }, { DB: {} });
        expect(res.status).toBe(201);
    });
});
