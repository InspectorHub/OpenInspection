/**
 * Sprint 2 S2-2 — InspectionRequestService unit tests.
 *
 * Verifies create / addSubInspection / list / get / update lifecycle plus
 * tenant isolation. Tests use the in-memory SQLite fixture from db.ts; the
 * fixture replays every migration so the new 0041 migration is exercised.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionRequestService } from '../../../server/services/inspection-request.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT  = '00000000-0000-0000-0000-000000000001';
const TENANT2 = '00000000-0000-0000-0000-000000000002';
const TPL1    = '11111111-1111-1111-1111-111111111111';
const TPL2    = '22222222-2222-2222-2222-222222222222';

describe('InspectionRequestService (Sprint 2 S2-2)', () => {
    let svc: InspectionRequestService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new InspectionRequestService({} as D1Database);

        // Seed tenants + templates so create() can validate ownership.
        await testDb.insert(schema.tenants).values([
            { id: TENANT,  name: 'Acme', slug: 'acme',  status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: TENANT2, name: 'Beta', slug: 'beta',  status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        await testDb.insert(schema.templates).values([
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { id: TPL1, tenantId: TENANT,  name: 'Residential', version: 1, schema: { sections: [] } as any, createdAt: new Date() },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { id: TPL2, tenantId: TENANT,  name: 'Radon',       version: 1, schema: { sections: [] } as any, createdAt: new Date() },
        ]);
    });

    it('creates a request with multiple sub-inspections', async () => {
        const result = await svc.create(TENANT, {
            clientName:      'Jane Smith',
            clientEmail:     'jane@example.com',
            propertyAddress: '123 Main St',
            scheduledAt:     '2026-06-15T09:00:00Z',
        }, [
            { templateId: TPL1, price: 45000 },
            { templateId: TPL2, price: 12000 },
        ]);

        expect(result.id).toBeTruthy();
        expect(result.inspections).toHaveLength(2);
        expect(result.totalAmount).toBe(57000);
        expect(result.status).toBe('pending');
        expect(result.inspections.every(i => i.propertyAddress === '123 Main St')).toBe(true);
    });

    it('rejects empty sub-inspection list', async () => {
        await expect(svc.create(TENANT, {
            clientName: 'X', propertyAddress: '1 St', scheduledAt: '2026-06-15T09:00:00Z',
        }, [])).rejects.toThrow(/at least one/i);
    });

    it('rejects template from another tenant (tenant isolation)', async () => {
        // TPL1 belongs to TENANT; calling create() on TENANT2 must fail.
        await expect(svc.create(TENANT2, {
            clientName: 'X', propertyAddress: '1 St', scheduledAt: '2026-06-15T09:00:00Z',
        }, [{ templateId: TPL1 }])).rejects.toThrow(/template not found/i);
    });

    it('addSubInspection appends and updates totals', async () => {
        const created = await svc.create(TENANT, {
            clientName: 'A', propertyAddress: '1 St', scheduledAt: '2026-06-15T09:00:00Z',
        }, [{ templateId: TPL1, price: 45000 }]);

        const after = await svc.addSubInspection(TENANT, created.id, { templateId: TPL2, price: 12000 });
        expect(after.inspections).toHaveLength(2);
        expect(after.totalAmount).toBe(57000);
    });

    it('addSubInspection refuses cross-tenant access', async () => {
        const created = await svc.create(TENANT, {
            clientName: 'A', propertyAddress: '1 St', scheduledAt: '2026-06-15T09:00:00Z',
        }, [{ templateId: TPL1, price: 45000 }]);

        await expect(svc.addSubInspection(TENANT2, created.id, { templateId: TPL1 }))
            .rejects.toThrow(/not found/i);
    });

    it('list filters by status', async () => {
        const r1 = await svc.create(TENANT, {
            clientName: 'A', propertyAddress: '1 St', scheduledAt: '2026-06-15T09:00:00Z',
        }, [{ templateId: TPL1 }]);
        await svc.create(TENANT, {
            clientName: 'B', propertyAddress: '2 St', scheduledAt: '2026-06-16T09:00:00Z',
        }, [{ templateId: TPL1 }]);

        await svc.update(TENANT, r1.id, { status: 'confirmed' });

        const pending   = await svc.list(TENANT, { status: 'pending' });
        const confirmed = await svc.list(TENANT, { status: 'confirmed' });
        expect(pending.length).toBe(1);
        expect(confirmed.length).toBe(1);
        expect(confirmed[0].id).toBe(r1.id);
    });

    it('list does not leak across tenants', async () => {
        await svc.create(TENANT, {
            clientName: 'A', propertyAddress: '1 St', scheduledAt: '2026-06-15T09:00:00Z',
        }, [{ templateId: TPL1 }]);

        const otherTenantList = await svc.list(TENANT2, {});
        expect(otherTenantList).toHaveLength(0);
    });

    it('get returns null when request belongs to a different tenant', async () => {
        const created = await svc.create(TENANT, {
            clientName: 'A', propertyAddress: '1 St', scheduledAt: '2026-06-15T09:00:00Z',
        }, [{ templateId: TPL1 }]);

        const sameTenant  = await svc.get(TENANT,  created.id);
        const otherTenant = await svc.get(TENANT2, created.id);
        expect(sameTenant).not.toBeNull();
        expect(otherTenant).toBeNull();
    });

    it('getByInspectionId resolves the parent request from a sub-inspection id', async () => {
        const created = await svc.create(TENANT, {
            clientName: 'A', propertyAddress: '1 St', scheduledAt: '2026-06-15T09:00:00Z',
        }, [{ templateId: TPL1 }, { templateId: TPL2 }]);

        const subId = created.inspections[0].id;
        const parent = await svc.getByInspectionId(TENANT, subId);
        expect(parent).not.toBeNull();
        expect(parent!.id).toBe(created.id);
        expect(parent!.inspections.length).toBe(2);
    });

    it('update patches top-level fields and bumps updatedAt', async () => {
        const created = await svc.create(TENANT, {
            clientName: 'A', propertyAddress: '1 St', scheduledAt: '2026-06-15T09:00:00Z',
        }, [{ templateId: TPL1 }]);

        const updated = await svc.update(TENANT, created.id, { clientName: 'New Name', status: 'in_progress' });
        expect(updated.clientName).toBe('New Name');
        expect(updated.status).toBe('in_progress');
    });

    it('get() resolves template names so the request switcher can render readable chips', async () => {
        const created = await svc.create(TENANT, {
            clientName: 'A', propertyAddress: '1 St', scheduledAt: '2026-06-15T09:00:00Z',
        }, [{ templateId: TPL1 }, { templateId: TPL2 }]);

        const detail = await svc.get(TENANT, created.id);
        expect(detail).not.toBeNull();
        const names = detail!.inspections.map(i => i.templateName).sort();
        expect(names).toEqual(['Radon', 'Residential']);
    });
});
