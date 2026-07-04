import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { inspectionInspectors, serviceInspectors, availability, availabilityOverrides } from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

describe('Track G schema', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db; sqlite = setup.sqlite;
        await setupSchema(sqlite);
    });
    afterEach(() => sqlite.close());

    it('inserts and reads inspection_inspectors link rows', async () => {
        await db.insert(inspectionInspectors).values({
            inspectionId: 'i1', userId: 'u1', tenantId: 't1', role: 'lead', createdAt: new Date(),
        });
        const rows = await db.select().from(inspectionInspectors).all();
        expect(rows).toHaveLength(1);
        expect(rows[0].role).toBe('lead');
    });

    it('zero service_inspectors rows means the table is queryable empty', async () => {
        const rows = await db.select().from(serviceInspectors).all();
        expect(rows).toHaveLength(0);
    });

    it('rejects duplicate weekly availability windows (DB-9)', async () => {
        // better-sqlite3 enables FK enforcement by default, so seed the parent
        // tenant and user rows that availability.tenant_id / inspector_id reference.
        sqlite.prepare(
            `INSERT INTO tenants (id, name, slug, tier, status, max_users, deployment_mode, created_at) VALUES (?,?,?,?,?,?,?,?)`
        ).run('t1', 'Test Co', 'test-co', 'free', 'active', 5, 'shared', Date.now());
        sqlite.prepare(
            `INSERT INTO users (id, tenant_id, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?)`
        ).run('u1', 't1', 'insp@example.com', 'hash', 'inspector', Date.now());

        const row = { id: 'a1', tenantId: 't1', inspectorId: 'u1', dayOfWeek: 1, startTime: '08:00', endTime: '17:00', createdAt: new Date() };
        await db.insert(availability).values(row);
        await expect(
            db.insert(availability).values({ ...row, id: 'a2' })
        ).rejects.toThrow();
    });

    it('partial unique index allows multiple is_available=1 rows but rejects duplicate is_available=0 rows (DB-9)', async () => {
        // Seed parent tenant and user rows (FK enforcement active in better-sqlite3).
        sqlite.prepare(
            `INSERT INTO tenants (id, name, slug, tier, status, max_users, deployment_mode, created_at) VALUES (?,?,?,?,?,?,?,?)`
        ).run('t2', 'Override Co', 'override-co', 'free', 'active', 5, 'shared', Date.now());
        sqlite.prepare(
            `INSERT INTO users (id, tenant_id, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?)`
        ).run('u2', 't2', 'insp2@example.com', 'hash', 'inspector', Date.now());

        const baseOverride = { tenantId: 't2', inspectorId: 'u2', date: '2026-07-04', createdAt: new Date() };

        // Two is_available = 1 rows for the same (inspectorId, date): both must succeed
        // (the PARTIAL index only covers is_available = 0 rows).
        await db.insert(availabilityOverrides).values({ ...baseOverride, id: 'ov1', isAvailable: true, startTime: '08:00', endTime: '12:00' });
        await db.insert(availabilityOverrides).values({ ...baseOverride, id: 'ov2', isAvailable: true, startTime: '13:00', endTime: '17:00' });
        const openRows = await db.select().from(availabilityOverrides).all();
        expect(openRows).toHaveLength(2);

        // First is_available = 0 row: must succeed.
        await db.insert(availabilityOverrides).values({ ...baseOverride, id: 'ov3', isAvailable: false });

        // Second is_available = 0 row for the same (inspectorId, date): must be rejected by the partial index.
        await expect(
            db.insert(availabilityOverrides).values({ ...baseOverride, id: 'ov4', isAvailable: false })
        ).rejects.toThrow();
    });
});
