/**
 * Task 7 (people-role-profiles): InspectionCoreService.createInspection
 * writes inspection_people rows for the primary client, buyer's agent, and
 * listing agent via PeopleService.addPerson. Task 13 (DESTRUCTIVE) dropped
 * the legacy clientContactId / referredByAgentId / sellingAgentId columns
 * from `inspections` entirely — inspection_people is now the SOLE
 * persistence of WHO.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionCoreService } from '../../../server/services/inspection/inspection-core.service';
import { PeopleService } from '../../../server/services/people.service';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T1 = 't1';
const BUYER_AGENT = 'contact-buyer-agent';
const LISTING_AGENT = 'contact-listing-agent';

const BASE_DATA = {
    propertyAddress: '123 Main St',
    date: '2026-06-22',
    clientName: 'Jane Buyer',
    clientEmail: 'jane@example.com',
};

describe('InspectionCoreService.createInspection — writes inspection_people (Task 7)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let people: PeopleService;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);

        await db.insert(schema.tenants).values([
            { id: T1, name: 'Tenant One', slug: 't1', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        await seedRoleProfiles(db, T1, new Date(1));
        await db.insert(schema.contacts).values([
            { id: BUYER_AGENT, tenantId: T1, type: 'agent', name: 'Buyer Agent', email: 'ba@x.com', createdAt: new Date() },
            { id: LISTING_AGENT, tenantId: T1, type: 'agent', name: 'Listing Agent', email: 'la@x.com', createdAt: new Date() },
        ]);

        people = new PeopleService({ DB: {} as D1Database });
    });

    function makeSvc() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sdb = new ScopedDB(db as any, T1);
        return new InspectionCoreService({} as D1Database, undefined, sdb);
    }

    it('writes client + buyer_agent + listing_agent rows to inspection_people', async () => {
        const svc = makeSvc();
        const created = await svc.createInspection(T1, {
            ...BASE_DATA,
            referredByAgentId: BUYER_AGENT,
            sellingAgentId: LISTING_AGENT,
        });

        const rows = await people.listPeople(T1, created.id);
        expect(rows.map(r => r.roleKey).sort()).toEqual(['buyer_agent', 'client', 'listing_agent']);

        const client = rows.find(r => r.roleKey === 'client');
        expect(client?.email).toBe('jane@example.com');
        const buyerAgent = rows.find(r => r.roleKey === 'buyer_agent');
        expect(buyerAgent?.contactId).toBe(BUYER_AGENT);
        const listingAgent = rows.find(r => r.roleKey === 'listing_agent');
        expect(listingAgent?.contactId).toBe(LISTING_AGENT);
    });

    it('skips the client role when there is no named client (Private Client, no contact)', async () => {
        const svc = makeSvc();
        const created = await svc.createInspection(T1, {
            propertyAddress: '456 Side St',
            date: '2026-06-22',
        });

        const rows = await people.listPeople(T1, created.id);
        expect(rows).toEqual([]);
    });
});
