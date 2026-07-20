/**
 * Task 9c-X2 (people-role-profiles) — ContactService.listContacts'
 * inspectionCount must be sourced from the inspection_people join (uniform
 * across agent/client contact types), not the legacy
 * inspections.clientEmail/referredByAgentId columns (frozen cache, dropped
 * Task 13). Seeds ONLY inspection_people links — no legacy columns — so this
 * fails against the old dual-path (clientEmail-match / referredByAgentId-match)
 * implementation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContactService } from '../../../server/services/contact.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-000000000002';
const CLIENT_JANE = '00000000-0000-0000-0000-0000000000c1';
const CLIENT_NO_EMAIL = '00000000-0000-0000-0000-0000000000c2';
const AGENT_BOB = '00000000-0000-0000-0000-0000000000a1';

const roleProfileId = (tenantId: string, key: string) => `crp_${tenantId}_${key}`;

describe('ContactService.listContacts inspectionCount', () => {
    let svc: ContactService;
    let people: PeopleService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);

        await testDb.insert(schema.tenants).values([
            { id: TENANT_A, name: 'A', slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: TENANT_B, name: 'B', slug: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        await seedRoleProfiles(testDb, TENANT_A, new Date(1));
        await seedRoleProfiles(testDb, TENANT_B, new Date(1));
        await testDb.insert(schema.contacts).values([
            { id: CLIENT_JANE, tenantId: TENANT_A, type: 'client', name: 'Jane', email: 'jane@test.com', createdAt: new Date() },
            { id: CLIENT_NO_EMAIL, tenantId: TENANT_A, type: 'client', name: 'NoEmail', email: null, createdAt: new Date() },
            { id: AGENT_BOB, tenantId: TENANT_A, type: 'agent', name: 'Bob', email: 'bob@test.com', createdAt: new Date() },
        ]);
        // Legacy client/agent columns intentionally left unset — history is
        // sourced ENTIRELY from inspection_people (any role, any contact type).
        await testDb.insert(schema.inspections).values([
            { id: 'i-jane-1', tenantId: TENANT_A, propertyAddress: '1 St', date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date() },
            { id: 'i-jane-2', tenantId: TENANT_A, propertyAddress: '2 St', date: '2026-06-02', status: 'requested', paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date() },
            { id: 'i-bob-ref', tenantId: TENANT_A, propertyAddress: '3 St', date: '2026-06-03', status: 'requested', paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date() },
            { id: 'i-other-tenant', tenantId: TENANT_B, propertyAddress: '4 St', date: '2026-06-04', status: 'requested', paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date() },
        ]);

        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        svc = new ContactService({} as D1Database);
        people = new PeopleService({ DB: {} as D1Database });

        await people.addPerson(TENANT_A, 'i-jane-1', CLIENT_JANE, roleProfileId(TENANT_A, 'client'));
        await people.addPerson(TENANT_A, 'i-jane-2', CLIENT_JANE, roleProfileId(TENANT_A, 'client'));
        await people.addPerson(TENANT_A, 'i-bob-ref', AGENT_BOB, roleProfileId(TENANT_A, 'buyer_agent'));
        await people.addPerson(TENANT_B, 'i-other-tenant', CLIENT_JANE, roleProfileId(TENANT_B, 'client'));
    });

    it('counts client inspections via inspection_people within tenant', async () => {
        const rows = await svc.listContacts(TENANT_A, { type: 'client', limit: 50, offset: 0 });
        const jane = rows.find(r => r.id === CLIENT_JANE);
        expect(jane?.inspectionCount).toBe(2);
    });

    it('returns 0 for contacts with no inspection_people rows', async () => {
        const rows = await svc.listContacts(TENANT_A, { type: 'client', limit: 50, offset: 0 });
        const noEmail = rows.find(r => r.id === CLIENT_NO_EMAIL);
        expect(noEmail?.inspectionCount).toBe(0);
    });

    it('agent counts via inspection_people too — uniform path, no agent/client branching', async () => {
        const rows = await svc.listContacts(TENANT_A, { type: 'agent', limit: 50, offset: 0 });
        const bob = rows.find(r => r.id === AGENT_BOB);
        expect(bob?.inspectionCount).toBe(1);
    });

    it('does not count cross-tenant inspection_people rows', async () => {
        const rows = await svc.listContacts(TENANT_B, { type: 'client', limit: 50, offset: 0 });
        expect(rows.length).toBe(0); // no contacts seeded in B
    });
});
