/**
 * Task 4 (#183): cross-tenant contact/agent id validation on inspection create.
 *
 * D1 enforces no FK constraints at runtime. This suite verifies that
 * InspectionCoreService.createInspection rejects any referredByAgentId,
 * sellingAgentId, or clientContactId that belongs to a different tenant
 * before inserting the inspections row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InspectionCoreService } from '../../../server/services/inspection/inspection-core.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T1 = '00000000-0000-0000-0000-000000000001';
const T2 = '00000000-0000-0000-0000-000000000002';

const CONTACT_T1 = '00000000-0000-0000-0000-000000000010';
const CONTACT_T2 = '00000000-0000-0000-0000-000000000020';

async function seedFixtures(db: BetterSQLite3Database<typeof schema>) {
    await db.insert(schema.tenants).values([
        { id: T1, name: 'Tenant One', slug: 't1', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        { id: T2, name: 'Tenant Two', slug: 't2', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    ]);
    await db.insert(schema.contacts).values([
        { id: CONTACT_T1, tenantId: T1, type: 'agent', name: 'Agent One', email: 'agent1@t1.com', createdAt: new Date() },
        { id: CONTACT_T2, tenantId: T2, type: 'agent', name: 'Agent Two', email: 'agent2@t2.com', createdAt: new Date() },
    ]);
    // Task 13 — client/agent identity is persisted ONLY via inspection_people
    // now; createInspection's Task 7 people-write resolves role profile ids
    // by key, so the role profiles must exist for the write to land.
    await seedRoleProfiles(db, T1, new Date());
}

const BASE_DATA = {
    propertyAddress: '123 Main St',
    date: '2026-06-22',
};

describe('InspectionCoreService.createInspection — cross-tenant contact validation (#183)', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        await seedFixtures(db);
    });

    function makeSvc(tenantId: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sdb = new ScopedDB(db as any, tenantId);
        return new InspectionCoreService({} as D1Database, undefined, sdb);
    }

    // -------------------------------------------------------------------------
    // Negative: cross-tenant referredByAgentId must be rejected pre-insert
    // -------------------------------------------------------------------------
    it('rejects referredByAgentId belonging to a different tenant and inserts no row', async () => {
        const svc = makeSvc(T1);

        await expect(
            svc.createInspection(T1, { ...BASE_DATA, referredByAgentId: CONTACT_T2 })
        ).rejects.toThrow('Unknown contact for this workspace');

        const rows = await db.select().from(schema.inspections)
            .where(eq(schema.inspections.tenantId, T1)).all();
        expect(rows).toHaveLength(0);
    });

    // -------------------------------------------------------------------------
    // Negative: cross-tenant sellingAgentId must be rejected pre-insert
    // -------------------------------------------------------------------------
    it('rejects sellingAgentId belonging to a different tenant and inserts no row', async () => {
        const svc = makeSvc(T1);

        await expect(
            svc.createInspection(T1, { ...BASE_DATA, sellingAgentId: CONTACT_T2 })
        ).rejects.toThrow('Unknown contact for this workspace');

        const rows = await db.select().from(schema.inspections)
            .where(eq(schema.inspections.tenantId, T1)).all();
        expect(rows).toHaveLength(0);
    });

    // -------------------------------------------------------------------------
    // Negative: cross-tenant clientContactId must be rejected pre-insert
    // -------------------------------------------------------------------------
    it('rejects clientContactId belonging to a different tenant and inserts no row', async () => {
        const svc = makeSvc(T1);

        await expect(
            svc.createInspection(T1, { ...BASE_DATA, clientContactId: CONTACT_T2 })
        ).rejects.toThrow('Unknown contact for this workspace');

        const rows = await db.select().from(schema.inspections)
            .where(eq(schema.inspections.tenantId, T1)).all();
        expect(rows).toHaveLength(0);
    });

    // -------------------------------------------------------------------------
    // Positive: contact owned by T1 must pass (inspection is created)
    // -------------------------------------------------------------------------
    it('allows referredByAgentId belonging to the same tenant (inspection created)', async () => {
        const svc = makeSvc(T1);

        const created = await svc.createInspection(T1, { ...BASE_DATA, referredByAgentId: CONTACT_T1 });

        const rows = await db.select().from(schema.inspections)
            .where(eq(schema.inspections.tenantId, T1)).all();
        expect(rows).toHaveLength(1);

        // Task 13 dropped inspections.referredByAgentId — the buyer_agent
        // link now lives ONLY in inspection_people.
        const buyerAgentContactId = await new PeopleService({ DB: {} as D1Database })
            .contactIdForRole(T1, created.id, 'buyer_agent');
        expect(buyerAgentContactId).toBe(CONTACT_T1);
    });

    // -------------------------------------------------------------------------
    // Positive: no contact ids — guard short-circuits, no error
    // -------------------------------------------------------------------------
    it('allows creation with no contact ids (guard short-circuits on empty list)', async () => {
        const svc = makeSvc(T1);

        await expect(
            svc.createInspection(T1, { ...BASE_DATA })
        ).resolves.toBeDefined();

        const rows = await db.select().from(schema.inspections)
            .where(eq(schema.inspections.tenantId, T1)).all();
        expect(rows).toHaveLength(1);
    });
});
