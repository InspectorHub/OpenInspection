/**
 * IA-6 — findScheduleConflicts unit tests.
 *
 * Tests the pure DB-layer function directly (extracted service layer pattern),
 * seeding an in-memory SQLite DB via createTestDb/setupSchema.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from './db';
import { tenants, users, inspections, inspectionInspectors } from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../server/lib/db/schema';

// The function under test calls drizzle(c.env.DB) indirectly via route handlers,
// but the extracted findScheduleConflicts takes a drizzle instance directly — no mock needed.
import { findScheduleConflicts } from '../../server/lib/schedule-conflicts';

const TENANT_ID = 't1';
const U2 = 'u2';
const U3 = 'u3';
const I1 = 'i1';
const I2 = 'i2';

// i1 is scheduled at 09:00 UTC on 2026-06-08
const I1_DATE = '2026-06-08T09:00:00Z';

describe('findScheduleConflicts', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db as BetterSQLite3Database<typeof schema>;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);

        // Seed tenant
        await db.insert(tenants).values({
            id: TENANT_ID, name: 'Test Co', slug: 'test-co',
            tier: 'free', status: 'active', maxUsers: 5,
            deploymentMode: 'shared', createdAt: new Date(),
        } as any);

        // Seed users
        await db.insert(users).values([
            { id: U2, tenantId: TENANT_ID, email: 'u2@example.com', passwordHash: 'h', role: 'inspector', name: 'Lead', createdAt: new Date() },
            { id: U3, tenantId: TENANT_ID, email: 'u3@example.com', passwordHash: 'h', role: 'inspector', name: 'Helper', createdAt: new Date() },
        ] as any);

        // Seed inspection i1 at 09:00 UTC 2026-06-08
        await db.insert(inspections).values({
            id: I1, tenantId: TENANT_ID, propertyAddress: '123 Main St', date: I1_DATE,
            status: 'scheduled', createdAt: new Date(), price: 0,
        } as any);

        // u2 is lead on i1; u3 is helper on i1
        await db.insert(inspectionInspectors).values([
            { inspectionId: I1, userId: U2, tenantId: TENANT_ID, role: 'lead', createdAt: new Date() },
            { inspectionId: I1, userId: U3, tenantId: TENANT_ID, role: 'helper', createdAt: new Date() },
        ] as any);
    });

    afterEach(() => sqlite.close());

    it('1. u2 + 09:30 on same UTC day → hits i1 (same day+hour)', async () => {
        const result = await findScheduleConflicts(db as any, TENANT_ID, U2, '2026-06-08T09:30:00Z');
        expect(result).toHaveLength(1);
        expect(result[0].inspectionId).toBe(I1);
        expect(result[0].propertyAddress).toBe('123 Main St');
    });

    it('2. u2 + 10:00 on same day → different hour → empty (no conflict)', async () => {
        const result = await findScheduleConflicts(db as any, TENANT_ID, U2, '2026-06-08T10:00:00Z');
        expect(result).toHaveLength(0);
    });

    it('3. u2 + 09:30 with excludeId=i1 → empty (rescheduling yourself is not a conflict)', async () => {
        const result = await findScheduleConflicts(db as any, TENANT_ID, U2, '2026-06-08T09:30:00Z', I1);
        expect(result).toHaveLength(0);
    });

    it('4. u3 (helper) + 09:15 → hits i1 (helpers count too)', async () => {
        const result = await findScheduleConflicts(db as any, TENANT_ID, U3, '2026-06-08T09:15:00Z');
        expect(result).toHaveLength(1);
        expect(result[0].inspectionId).toBe(I1);
    });

    it('5. cancelled inspection at same slot → not returned', async () => {
        // Seed a second inspection for u2 at the same hour but cancelled
        await db.insert(inspections).values({
            id: I2, tenantId: TENANT_ID, propertyAddress: '999 Cancel Ave', date: '2026-06-08T09:05:00Z',
            status: 'cancelled', createdAt: new Date(), price: 0,
        } as any);
        await db.insert(inspectionInspectors).values([
            { inspectionId: I2, userId: U2, tenantId: TENANT_ID, role: 'lead', createdAt: new Date() },
        ] as any);

        const result = await findScheduleConflicts(db as any, TENANT_ID, U2, '2026-06-08T09:30:00Z');
        // Only i1 should appear; i2 is cancelled and must be excluded
        expect(result).toHaveLength(1);
        expect(result[0].inspectionId).toBe(I1);
    });

    it('6. plain YYYY-MM-DD proposed date (all-day semantics) → hits i1', async () => {
        // A bare date string (no time component) is treated as an all-day occupant
        // by sameDayHour: any existing inspection on that calendar day is a conflict,
        // regardless of hour. i1 is on 2026-06-08 so it must be returned.
        const result = await findScheduleConflicts(db as any, TENANT_ID, U2, '2026-06-08');
        expect(result).toHaveLength(1);
        expect(result[0].inspectionId).toBe(I1);
    });
});
