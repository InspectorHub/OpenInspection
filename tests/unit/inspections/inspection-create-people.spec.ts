/**
 * IA-1 — inspection creation captures people: client upsert, agent linking,
 * price overrides.
 *
 * Tests the REAL mounted route (RBAC + zod + handler) by exercising
 * InspectionService + ContactService against an in-memory SQLite DB,
 * mirroring the inspection-create-policy.spec.ts pattern.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InspectionService } from '../../../server/services/inspection.service';
import { ContactService } from '../../../server/services/contact.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, and } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000bb';

let testDb: BetterSQLite3Database<typeof schema>;
let sdb: ScopedDB;
let inspectionSvc: InspectionService;
let contactSvc: ContactService;
let peopleSvc: PeopleService;

// Service catalog id seeded in beforeEach
const SVC_ID = '00000000-0000-0000-0000-000000000901';

beforeEach(async () => {
    const fixture = createTestDb();
    testDb = fixture.db;
    await setupSchema(fixture.sqlite);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(testDb);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sdb = new ScopedDB(testDb as any, TENANT);

    // Seed tenant
    await testDb.insert(schema.tenants).values({
        id: TENANT, name: 'People Co', slug: 'people-co', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });

    // Seed a service catalog item
    await testDb.insert(schema.services).values({
        id: SVC_ID, tenantId: TENANT, name: 'General Home Inspection',
        price: 45000, active: true, sortOrder: 0, createdAt: new Date(),
    } as never);

    // Task 13 — client/agent identity is persisted ONLY via inspection_people
    // now (clientContactId/clientName/clientEmail/clientPhone/
    // referredByAgentId/sellingAgentId dropped from inspections). createInspection's
    // Task 7 people-write resolves role profile ids by key, so the role
    // profiles must exist for the write to land.
    await seedRoleProfiles(testDb, TENANT, new Date());

    inspectionSvc = new InspectionService({} as D1Database, undefined, sdb);
    contactSvc = new ContactService({} as D1Database);
    peopleSvc = new PeopleService({ DB: {} as D1Database });
});

// ---------------------------------------------------------------------------
// 1. create with client lands FK + denormalized trio
// ---------------------------------------------------------------------------
describe('client capture via upsertClientContact then createInspection', () => {
    it('links the client contact into inspection_people (Task 13 — dropped clientContactId/clientName/clientEmail/clientPhone columns)', async () => {
        // Simulate what the handler does: upsert the client first, then create.
        const { id: clientContactId } = await contactSvc.upsertClientContact(TENANT, {
            name: 'Jane Buyer', email: 'jane@buyer.com', phone: '555-0100', type: 'client',
        });

        await inspectionSvc.createInspection(TENANT, {
            propertyAddress: '10 Client Lane',
            clientName: 'Jane Buyer',
            clientEmail: 'jane@buyer.com',
            clientPhone: '555-0100',
            clientContactId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        const row = await testDb.select().from(schema.inspections).get();
        const primary = await peopleSvc.getPrimaryClient(TENANT, row!.id);
        expect(primary?.contactId).toBe(clientContactId);
        expect(primary?.name).toBe('Jane Buyer');
        expect(primary?.email).toBe('jane@buyer.com');
        expect(primary?.phone).toBe('555-0100');

        // Verify the contact row was created correctly.
        const contact = await testDb.select().from(schema.contacts)
            .where(eq(schema.contacts.id, clientContactId)).get();
        expect(contact?.type).toBe('client');
        expect(contact?.email).toBe('jane@buyer.com');
    });
});

// ---------------------------------------------------------------------------
// 2. Second create with same client email reuses the SAME contact id
// ---------------------------------------------------------------------------
describe('returning customer reuses contact id', () => {
    it('second inspection with the same client email shares one contacts row', async () => {
        const email = 'returning@client.com';

        // First inspection
        const { id: firstContactId } = await contactSvc.upsertClientContact(TENANT, {
            name: 'Returning Client', email, type: 'client',
        });
        await inspectionSvc.createInspection(TENANT, {
            propertyAddress: '1 First St',
            clientName: 'Returning Client',
            clientEmail: email,
            clientContactId: firstContactId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        // Second inspection — same client, different property
        const { id: secondContactId, created } = await contactSvc.upsertClientContact(TENANT, {
            name: 'Returning Client', email, type: 'client',
        });
        await inspectionSvc.createInspection(TENANT, {
            propertyAddress: '2 Second Ave',
            clientName: 'Returning Client',
            clientEmail: email,
            clientContactId: secondContactId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        expect(created).toBe(false);
        expect(secondContactId).toBe(firstContactId);

        // Only ONE contacts row exists for this email.
        const contactRows = await testDb.select().from(schema.contacts)
            .where(and(eq(schema.contacts.tenantId, TENANT), eq(schema.contacts.email, email)));
        expect(contactRows).toHaveLength(1);

        // Both inspections reference the same contact, via inspection_people
        // (Task 13 — inspections.clientContactId dropped).
        const inspRows = await testDb.select().from(schema.inspections)
            .where(eq(schema.inspections.tenantId, TENANT));
        expect(inspRows).toHaveLength(2);
        for (const insp of inspRows) {
            const primary = await peopleSvc.getPrimaryClient(TENANT, insp.id);
            expect(primary?.contactId).toBe(firstContactId);
        }
    });
});

// ---------------------------------------------------------------------------
// 3. newAgent creates a type='agent' contact and links referredByAgentId
// ---------------------------------------------------------------------------
describe('new agent linking', () => {
    it('upserts an agent contact and links it into inspection_people as buyer_agent (Task 13 — dropped referredByAgentId column)', async () => {
        const { id: agentId } = await contactSvc.upsertClientContact(TENANT, {
            name: 'Tony Agent', email: 'tony@realty.com', type: 'agent',
        });

        await inspectionSvc.createInspection(TENANT, {
            propertyAddress: '99 Agent Way',
            clientName: 'Private Client',
            referredByAgentId: agentId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        const insp = await testDb.select().from(schema.inspections).get();
        const buyerAgentContactId = await peopleSvc.contactIdForRole(TENANT, insp!.id, 'buyer_agent');
        expect(buyerAgentContactId).toBe(agentId);

        // Verify the contact has type='agent'.
        const contact = await testDb.select().from(schema.contacts)
            .where(eq(schema.contacts.id, agentId)).get();
        expect(contact?.type).toBe('agent');
    });
});

// ---------------------------------------------------------------------------
// 4. serviceSelections override lands in inspection_services.priceOverride
// ---------------------------------------------------------------------------
describe('serviceSelections price override', () => {
    it('writes priceOverride onto the inspection_services row when serviceSelections carries an override', async () => {
        // Create with serviceSelections (the handler merges this; here we call
        // the service directly with the merged data, then call applyServicePriceOverrides).
        const selections = [{ serviceId: SVC_ID, priceOverrideCents: 39900 }];

        await inspectionSvc.createInspection(TENANT, {
            propertyAddress: '55 Override Blvd',
            clientName: 'Price Override Client',
            serviceSelections: selections,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        const insp = await testDb.select().from(schema.inspections).get();
        expect(insp).toBeTruthy();

        // applyServicePriceOverrides is the post-create step the handler calls.
        await inspectionSvc.applyServicePriceOverrides(insp!.id, TENANT, selections);

        const iSvcRow = await testDb.select().from(schema.inspectionServices)
            .where(and(
                eq(schema.inspectionServices.inspectionId, insp!.id),
                eq(schema.inspectionServices.serviceId, SVC_ID),
            )).get();

        expect(iSvcRow).toBeTruthy();
        expect(iSvcRow?.priceOverride).toBe(39900);
        // Catalog price snapshot is preserved.
        expect(iSvcRow?.priceSnapshot).toBe(45000);
    });
});
