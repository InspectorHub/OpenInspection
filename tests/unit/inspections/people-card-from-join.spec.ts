/**
 * Task 8 (people-role-profiles): getPeopleCard + getRecipientList must read
 * people from inspection_people (via PeopleService.listPeople) instead of the
 * legacy inline columns + fetchAgentsById, while preserving the exact return
 * shapes. This spec seeds an inspection with the LEGACY people columns NULL
 * and only inspection_people rows populated, so it fails against the old
 * implementation (which reads only the legacy columns).
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
const CLIENT = 'contact-client';
const BUYER_AGENT = 'contact-buyer-agent';
const LISTING_AGENT = 'contact-listing-agent';
const INSP = 'insp-people-join-1';

const roleProfileId = (key: string) => `crp_${T1}_${key}`;

describe('InspectionCoreService.getPeopleCard / getRecipientList — read from inspection_people (Task 8)', () => {
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
            { id: CLIENT,       tenantId: T1, type: 'client', name: 'Jane Client',       email: 'jane@example.com', phone: '+15551234567', createdAt: new Date() },
            { id: BUYER_AGENT,  tenantId: T1, type: 'agent',  name: 'Bob Buyer-Agent',    email: 'bob@bba.com',     phone: null, agency: 'Buyer Realty',   createdAt: new Date() },
            { id: LISTING_AGENT, tenantId: T1, type: 'agent', name: 'Lisa Listing-Agent', email: 'lisa@lla.com',    phone: null, agency: 'Listing Realty', createdAt: new Date() },
        ]);

        // Legacy people columns are intentionally left NULL — only
        // inspection_people carries the people for this inspection.
        await db.insert(schema.inspections).values({
            id:                INSP,
            tenantId:          T1,
            propertyAddress:   '1 Main St',
            clientName:        null,
            clientEmail:       null,
            clientPhone:       null,
            referredByAgentId: null,
            sellingAgentId:    null,
            date:              '2026-06-01',
            status:            'requested',
            paymentStatus:     'unpaid',
            price:             0,
            paymentRequired:   false,
            agreementRequired: false,
            createdAt:         new Date(),
        });

        people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(T1, INSP, CLIENT,       roleProfileId('client'));
        await people.addPerson(T1, INSP, BUYER_AGENT,  roleProfileId('buyer_agent'));
        await people.addPerson(T1, INSP, LISTING_AGENT, roleProfileId('listing_agent'));
    });

    function makeSvc() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sdb = new ScopedDB(db as any, T1);
        return new InspectionCoreService({} as D1Database, undefined, sdb);
    }

    it('getPeopleCard sources client/buyerAgents/listingAgents from inspection_people', async () => {
        const svc = makeSvc();
        const card = await svc.getPeopleCard(INSP, T1);

        expect(card.client).toMatchObject({ name: 'Jane Client', email: 'jane@example.com', phone: '+15551234567' });

        expect(card.buyerAgents).toHaveLength(1);
        // Agent .id must be the CONTACT id, not the inspection_people join-row id.
        expect(card.buyerAgents[0]).toMatchObject({
            id: BUYER_AGENT, name: 'Bob Buyer-Agent', email: 'bob@bba.com', agency: 'Buyer Realty',
        });

        expect(card.listingAgents).toHaveLength(1);
        expect(card.listingAgents[0]).toMatchObject({
            id: LISTING_AGENT, name: 'Lisa Listing-Agent', email: 'lisa@lla.com', agency: 'Listing Realty',
        });
    });

    it('getRecipientList sources the role set + contactId from inspection_people', async () => {
        const svc = makeSvc();
        const list = await svc.getRecipientList(INSP, T1);

        expect(list.map(r => r.role).sort()).toEqual(['agent_buyer', 'agent_listing', 'client']);

        const client = list.find(r => r.role === 'client');
        expect(client?.contactId).toBe(CLIENT);
        expect(client).toMatchObject({ name: 'Jane Client', email: 'jane@example.com', phone: '+15551234567' });
    });
});
