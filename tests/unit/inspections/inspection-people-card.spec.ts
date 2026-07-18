import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionService } from '../../../server/services/inspection.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';

// getPeopleCard (Task 8) now sources people from inspection_people (via
// PeopleService.listPeople), not the legacy inline/agent-id columns — tests
// below seed inspection_people rows alongside the legacy columns so the
// legacy columns stay realistic without being what's actually read.
const roleProfileId = (tenantId: string, key: string) => `crp_${tenantId}_${key}`;

describe('Round-2 F3 — InspectionService.getPeopleCard', () => {
    let svc: InspectionService;
    let testDb: BetterSQLite3Database<typeof schema>;
    let people: PeopleService;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new InspectionService({} as D1Database);
        people = new PeopleService({ DB: {} as D1Database });

        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'Acme', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        await seedRoleProfiles(testDb, TENANT, new Date(1));
    });

    it('returns inspector + client + agents grouped by role', async () => {
        await testDb.insert(schema.users).values({
            id:           'user-insp',
            tenantId:     TENANT,
            email:        'inspector@acme.com',
            passwordHash: 'x',
            name:         'Sam Inspector',
            phone:        '+15550009999',
            role:         'inspector',
            createdAt:    new Date(),
        });
        await testDb.insert(schema.contacts).values([
            { id: 'client-people-1', tenantId: TENANT, type: 'client', name: 'Jane Buyer',        email: 'jane@example.com', phone: '+15551234567', createdAt: new Date() },
            { id: 'agent-buyer-1',   tenantId: TENANT, type: 'agent', name: 'Bob Buyer-Agent',    email: 'bob@bba.com',  phone: '+15550001111', createdAt: new Date() },
            { id: 'agent-listing-1', tenantId: TENANT, type: 'agent', name: 'Lisa Listing-Agent', email: 'lisa@lla.com', phone: null,            createdAt: new Date() },
        ]);
        await testDb.insert(schema.inspections).values({
            id:                'insp-people-1',
            tenantId:          TENANT,
            inspectorId:       'user-insp',
            propertyAddress:   '1 Main St',
            clientName:        'Jane Buyer',
            clientEmail:       'jane@example.com',
            clientPhone:       '+15551234567',
            referredByAgentId: 'agent-buyer-1',
            sellingAgentId:    'agent-listing-1',
            date:              '2026-06-01',
            status:            'completed',
            paymentStatus:     'unpaid',
            price:             0,
            paymentRequired:   false,
            agreementRequired: false,
            createdAt:         new Date(),
        });
        await people.addPerson(TENANT, 'insp-people-1', 'client-people-1', roleProfileId(TENANT, 'client'));
        await people.addPerson(TENANT, 'insp-people-1', 'agent-buyer-1',   roleProfileId(TENANT, 'buyer_agent'));
        await people.addPerson(TENANT, 'insp-people-1', 'agent-listing-1', roleProfileId(TENANT, 'listing_agent'));

        const card = await svc.getPeopleCard('insp-people-1', TENANT);

        expect(card.inspector).toMatchObject({
            name: 'Sam Inspector', email: 'inspector@acme.com', phone: '+15550009999',
        });
        expect(card.client).toMatchObject({
            name: 'Jane Buyer', email: 'jane@example.com', phone: '+15551234567',
        });
        expect(card.buyerAgents).toHaveLength(1);
        expect(card.buyerAgents[0]).toMatchObject({ name: 'Bob Buyer-Agent', email: 'bob@bba.com' });
        expect(card.listingAgents).toHaveLength(1);
        expect(card.listingAgents[0]).toMatchObject({ name: 'Lisa Listing-Agent', email: 'lisa@lla.com' });
    });

    it('returns nulls / empty arrays when nothing is linked', async () => {
        await testDb.insert(schema.inspections).values({
            id:                'insp-bare',
            tenantId:          TENANT,
            propertyAddress:   '1 Main St',
            clientName:        null,
            clientEmail:       null,
            clientPhone:       null,
            date:              '2026-06-01',
            status:            'requested',
            paymentStatus:     'unpaid',
            price:             0,
            paymentRequired:   false,
            agreementRequired: false,
            createdAt:         new Date(),
        });

        const card = await svc.getPeopleCard('insp-bare', TENANT);
        expect(card.inspector).toBeNull();
        expect(card.client).toBeNull();
        expect(card.buyerAgents).toEqual([]);
        expect(card.listingAgents).toEqual([]);
    });

    it('throws NotFound for cross-tenant access', async () => {
        const OTHER = '00000000-0000-0000-0000-0000000000ff';
        await testDb.insert(schema.tenants).values({
            id: OTHER, name: 'Other', slug: 'other', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: 'insp-other', tenantId: OTHER,
            propertyAddress: 'X', clientName: null, clientEmail: null, clientPhone: null,
            date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
            price: 0, paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });

        await expect(svc.getPeopleCard('insp-other', TENANT)).rejects.toThrow();
    });

    it('returns counts per role group for templating', async () => {
        await testDb.insert(schema.contacts).values([
            { id: 'client-counts',  tenantId: TENANT, type: 'client', name: 'Jane', email: 'jane@example.com', phone: null, createdAt: new Date() },
            { id: 'agent-buyer-1', tenantId: TENANT, type: 'agent', name: 'Bob', email: 'b@b.com', phone: null, createdAt: new Date() },
        ]);
        await testDb.insert(schema.inspections).values({
            id:                'insp-counts',
            tenantId:          TENANT,
            propertyAddress:   '1 Main St',
            clientName:        'Jane',
            clientEmail:       'jane@example.com',
            clientPhone:       null,
            referredByAgentId: 'agent-buyer-1',
            date:              '2026-06-01',
            status:            'requested',
            paymentStatus:     'unpaid',
            price:             0,
            paymentRequired:   false,
            agreementRequired: false,
            createdAt:         new Date(),
        });
        await people.addPerson(TENANT, 'insp-counts', 'client-counts', roleProfileId(TENANT, 'client'));
        await people.addPerson(TENANT, 'insp-counts', 'agent-buyer-1', roleProfileId(TENANT, 'buyer_agent'));

        const card = await svc.getPeopleCard('insp-counts', TENANT);
        expect(card.buyerAgents).toHaveLength(1);
        expect(card.listingAgents).toHaveLength(0);
        // Only 1 agent exists — counter should be 1 (component renders "Buyer's Agent" without ·N).
        expect(card.buyerAgents[0]?.name).toBe('Bob');
    });
});
