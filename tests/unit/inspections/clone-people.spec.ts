/**
 * Task 7c (people-role-profiles fix, CRITICAL) — InspectionCoreService.
 * cloneInspection spreads the source inspection's legacy columns
 * (clientContactId / clientName / clientEmail / referredByAgentId / ...) onto
 * the clone, but never copied the source's inspection_people rows.
 * getInspection/listInspections (Task 9c-reads) resolve the client ONLY via
 * inspection_people, so every clone showed a null client — and would break
 * entirely once Task 13 drops the legacy columns.
 *
 * cloneInspection now copies ALL of the source's inspection_people rows
 * (client + any agents) onto the clone via PeopleService.listPeople ->
 * addPerson, non-fatal.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionService } from '../../../server/services/inspection.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { logger } from '../../../server/lib/logger';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const SOURCE = '11111111-1111-1111-1111-111111111111';
const CLIENT_CONTACT = '22222222-2222-2222-2222-222222222222';
const AGENT_CONTACT  = '33333333-3333-3333-3333-333333333333';

const roleProfileId = (tenantId: string, key: string) => `crp_${tenantId}_${key}`;

describe('InspectionService.cloneInspection — writes inspection_people (Task 7c)', () => {
    let svc: InspectionService;
    let testDb: BetterSQLite3Database<typeof schema>;
    let people: PeopleService;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sdb = new ScopedDB(testDb as any, TENANT);
        svc = new InspectionService({} as D1Database, undefined, sdb);
        people = new PeopleService({ DB: {} as D1Database });

        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(testDb, TENANT, new Date(1));

        await testDb.insert(schema.contacts).values([
            { id: CLIENT_CONTACT, tenantId: TENANT, type: 'client', name: 'Jane Buyer', email: 'jane@example.com', createdAt: new Date() },
            { id: AGENT_CONTACT,  tenantId: TENANT, type: 'agent',  name: 'Bob Agent',   email: 'bob@agency.com',  createdAt: new Date() },
        ]);

        await testDb.insert(schema.inspections).values({
            id: SOURCE, tenantId: TENANT,
            propertyAddress: '1 Main St', clientContactId: CLIENT_CONTACT,
            clientName: 'Jane Buyer', clientEmail: 'jane@example.com',
            referredByAgentId: AGENT_CONTACT,
            date: '2026-06-01', status: 'completed', paymentStatus: 'unpaid', price: 0,
            paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });
        await people.addPerson(TENANT, SOURCE, CLIENT_CONTACT, roleProfileId(TENANT, 'client'));
        await people.addPerson(TENANT, SOURCE, AGENT_CONTACT,  roleProfileId(TENANT, 'buyer_agent'));
    });

    it('CRITICAL — copies the client + agent into inspection_people, so getInspection resolves the client on the clone', async () => {
        const clone = await svc.cloneInspection(SOURCE, TENANT);

        const rows = await people.listPeople(TENANT, clone.id);
        expect(rows.map(r => r.roleKey).sort()).toEqual(['buyer_agent', 'client']);
        expect(rows.find(r => r.roleKey === 'client')?.contactId).toBe(CLIENT_CONTACT);

        const { inspection } = await svc.getInspection(clone.id, TENANT);
        expect(inspection.clientName).toBe('Jane Buyer');
        expect(inspection.clientEmail).toBe('jane@example.com');
    });

    it('does not fail the clone when the people-copy throws (non-fatal)', async () => {
        const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
        const addPersonSpy = vi.spyOn(PeopleService.prototype, 'addPerson').mockRejectedValue(new Error('boom'));

        const clone = await svc.cloneInspection(SOURCE, TENANT);

        expect(addPersonSpy).toHaveBeenCalled();
        expect(clone.id).toBeTruthy();
        expect(errorSpy).toHaveBeenCalled();
    });
});
