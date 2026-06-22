import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, setupSchema } from './db';
import { AvailabilityService } from '../../server/services/booking.service';
import { tenants, users, availabilityOverrides } from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-000000000002';
const INSPECTOR_ID = 'inspector-00000001';

describe('AvailabilityService — deleteOverride cross-tenant isolation', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let svc: AvailabilityService;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        svc = new AvailabilityService({} as D1Database);

        // Seed TENANT_A and TENANT_B
        await db.insert(tenants).values([
            { id: TENANT_A, name: 'Tenant A', slug: 'tenant-a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: TENANT_B, name: 'Tenant B', slug: 'tenant-b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);

        // Seed a user (inspector) under TENANT_A
        await db.insert(users).values({
            id: INSPECTOR_ID, tenantId: TENANT_A, email: 'inspector@a.com',
            passwordHash: 'hash', role: 'inspector', name: 'Inspector A', createdAt: new Date(),
        });
    });

    it('foreign-tenant deleteOverride does not delete TENANT_A row (same id, wrong tenantId)', async () => {
        // Seed an override under TENANT_A
        const overrideId = 'override-00000001';
        await db.insert(availabilityOverrides).values({
            id: overrideId,
            tenantId: TENANT_A,
            inspectorId: INSPECTOR_ID,
            date: '2026-07-01',
            isAvailable: false,
            createdAt: new Date(),
        });

        // Confirm it exists
        const before = await db.select().from(availabilityOverrides).all();
        expect(before.length).toBe(1);

        // TENANT_B tries to delete TENANT_A's override with the correct id
        await expect(
            svc.deleteOverride(TENANT_B, overrideId)
        ).rejects.toThrow(); // throws NotFound because SELECT is tenant-scoped

        // TENANT_A's override must still exist
        const after = await db.select().from(availabilityOverrides).all();
        expect(after.length).toBe(1);
        expect(after[0].id).toBe(overrideId);
    });
});
