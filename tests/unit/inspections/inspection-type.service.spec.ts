// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionTypeService } from '../../../server/services/inspection-type.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000099';
const OTHER = '00000000-0000-0000-0000-0000000000aa';

describe('InspectionTypeService', () => {
    let svc: InspectionTypeService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new InspectionTypeService({} as D1Database);
    });

    it('creates and lists a tenant inspection type', async () => {
        const row = await svc.createInspectionType(TENANT, {
            name: 'Medical Office',
            basedOn: 'office',
            description: 'Clinics and medical suites',
            sortOrder: 1,
        });
        expect(row.id).toBeTruthy();
        expect(row.tenantId).toBe(TENANT);
        expect(row.enabled).toBe(true);
        const list = await svc.listInspectionTypes(TENANT);
        expect(list).toHaveLength(1);
        expect(list[0].name).toBe('Medical Office');
        expect(list[0].basedOn).toBe('office');
    });

    it('orders by sortOrder', async () => {
        await svc.createInspectionType(TENANT, { name: 'Beta', sortOrder: 2 });
        await svc.createInspectionType(TENANT, { name: 'Alpha', sortOrder: 1 });
        const list = await svc.listInspectionTypes(TENANT);
        expect(list.map((t) => t.name)).toEqual(['Alpha', 'Beta']);
    });

    it('updates a type scoped to the tenant', async () => {
        const row = await svc.createInspectionType(TENANT, { name: 'Old', sortOrder: 0 });
        await svc.updateInspectionType(TENANT, row.id, { name: 'New', enabled: false });
        const list = await svc.listInspectionTypes(TENANT);
        expect(list[0].name).toBe('New');
        expect(list[0].enabled).toBe(false);
    });

    it('does not update across tenants', async () => {
        const row = await svc.createInspectionType(TENANT, { name: 'Mine', sortOrder: 0 });
        await svc.updateInspectionType(OTHER, row.id, { name: 'Hijacked' });
        const list = await svc.listInspectionTypes(TENANT);
        expect(list[0].name).toBe('Mine');
    });

    it('deletes a type scoped to the tenant', async () => {
        const row = await svc.createInspectionType(TENANT, { name: 'Temp', sortOrder: 0 });
        await svc.deleteInspectionType(OTHER, row.id); // wrong tenant — no-op
        expect(await svc.listInspectionTypes(TENANT)).toHaveLength(1);
        await svc.deleteInspectionType(TENANT, row.id);
        expect(await svc.listInspectionTypes(TENANT)).toHaveLength(0);
    });

    it('isolates types by tenant', async () => {
        await svc.createInspectionType(TENANT, { name: 'A', sortOrder: 0 });
        expect(await svc.listInspectionTypes(OTHER)).toHaveLength(0);
    });
});
