/**
 * Task 7b/7c (people-role-profiles) — InspectionRequestService inserts
 * `inspections` directly (not via InspectionCoreService.createInspection,
 * which already got the Task 7 people-write).
 *
 * `create()` mirrors BOTH the client (input.clientName is always present on
 * CreateRequestInput; resolved via the same idempotent ContactService.
 * upsertClientContact booking.service/core.ts use) AND the agent referral
 * (input.referredByAgentId, already stamped onto every sub-inspection's
 * referredByAgentId column) into inspection_people for EACH created
 * sub-inspection. Task 7c CRITICAL fix: before this, getInspection/
 * listInspections (Task 9c-reads) resolved the client ONLY via
 * inspection_people, so every request-created inspection showed a null
 * client.
 *
 * `addSubInspection()` inherits clientName/clientEmail from the parent
 * request (no separate client input at that call site) and mirrors the SAME
 * client into inspection_people for the new sub-inspection.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InspectionRequestService } from '../../../server/services/inspection-request.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { logger } from '../../../server/lib/logger';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT  = '00000000-0000-0000-0000-000000000001';
const TPL1    = '11111111-1111-1111-1111-111111111111';
const TPL2    = '22222222-2222-2222-2222-222222222222';
const AGENT_CONTACT = '33333333-3333-3333-3333-333333333333';

describe('InspectionRequestService.create — writes inspection_people (Task 7b/7c)', () => {
    let svc: InspectionRequestService;
    let testDb: BetterSQLite3Database<typeof schema>;
    let people: PeopleService;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new InspectionRequestService({} as D1Database);
        people = new PeopleService({ DB: {} as D1Database });

        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'Acme', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        await testDb.insert(schema.templates).values([
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { id: TPL1, tenantId: TENANT, name: 'Residential', version: 1, schema: { sections: [] } as any, createdAt: new Date() },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { id: TPL2, tenantId: TENANT, name: 'Radon', version: 1, schema: { sections: [] } as any, createdAt: new Date() },
        ]);
        await testDb.insert(schema.contacts).values([
            { id: AGENT_CONTACT, tenantId: TENANT, type: 'agent', name: 'Buyer Agent', email: 'ba@x.com', createdAt: new Date() },
        ]);
        await seedRoleProfiles(testDb as any, TENANT, new Date(1));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('CRITICAL — writes client + buyer_agent to EVERY sub-inspection created in one request', async () => {
        const result = await svc.create(TENANT, {
            clientName:      'Jane Smith',
            clientEmail:     'jane@example.com',
            propertyAddress: '123 Main St',
            scheduledAt:     '2026-06-15T09:00:00Z',
            referredByAgentId: AGENT_CONTACT,
        }, [
            { templateId: TPL1, price: 45000 },
            { templateId: TPL2, price: 12000 },
        ]);

        expect(result.inspections).toHaveLength(2);
        for (const insp of result.inspections) {
            const rows = await people.listPeople(TENANT, insp.id);
            expect(rows.map(r => r.roleKey).sort()).toEqual(['buyer_agent', 'client']);
            expect(rows.find(r => r.roleKey === 'buyer_agent')?.contactId).toBe(AGENT_CONTACT);
            const clientRow = rows.find(r => r.roleKey === 'client');
            expect(clientRow?.name).toBe('Jane Smith');
            expect(clientRow?.email).toBe('jane@example.com');
        }
    });

    it('CRITICAL — writes just the client when the request carries no agent referral', async () => {
        const result = await svc.create(TENANT, {
            clientName:      'Jane Smith',
            propertyAddress: '123 Main St',
            scheduledAt:     '2026-06-15T09:00:00Z',
        }, [{ templateId: TPL1 }]);

        const rows = await people.listPeople(TENANT, result.inspections[0].id);
        expect(rows.map(r => r.roleKey)).toEqual(['client']);
        expect(rows[0]?.name).toBe('Jane Smith');
    });

    it('reuses the same client contact across sub-inspections and across a second request from the same email', async () => {
        const email = 'returning@client.com';
        const first = await svc.create(TENANT, {
            clientName: 'Returning Client', clientEmail: email,
            propertyAddress: '1 First St', scheduledAt: '2026-06-15T09:00:00Z',
        }, [{ templateId: TPL1 }, { templateId: TPL2 }]);

        const rowsA = await people.listPeople(TENANT, first.inspections[0].id);
        const rowsB = await people.listPeople(TENANT, first.inspections[1].id);
        const contactIdA = rowsA.find(r => r.roleKey === 'client')?.contactId;
        const contactIdB = rowsB.find(r => r.roleKey === 'client')?.contactId;
        expect(contactIdA).toBeTruthy();
        expect(contactIdA).toBe(contactIdB);

        const second = await svc.create(TENANT, {
            clientName: 'Returning Client', clientEmail: email,
            propertyAddress: '2 Second Ave', scheduledAt: '2026-06-16T09:00:00Z',
        }, [{ templateId: TPL1 }]);
        const rowsC = await people.listPeople(TENANT, second.inspections[0].id);
        expect(rowsC.find(r => r.roleKey === 'client')?.contactId).toBe(contactIdA);
    });

    it('does not fail request creation when the people-write throws (non-fatal)', async () => {
        const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
        const addPersonSpy = vi.spyOn(PeopleService.prototype, 'addPerson').mockRejectedValue(new Error('boom'));

        const result = await svc.create(TENANT, {
            clientName:      'Jane Smith',
            propertyAddress: '123 Main St',
            scheduledAt:     '2026-06-15T09:00:00Z',
            referredByAgentId: AGENT_CONTACT,
        }, [{ templateId: TPL1 }]);

        expect(addPersonSpy).toHaveBeenCalled();
        expect(result.inspections).toHaveLength(1);
        expect(errorSpy).toHaveBeenCalled();
    });
});

describe('InspectionRequestService.addSubInspection — writes inspection_people (Task 7c)', () => {
    let svc: InspectionRequestService;
    let testDb: BetterSQLite3Database<typeof schema>;
    let people: PeopleService;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new InspectionRequestService({} as D1Database);
        people = new PeopleService({ DB: {} as D1Database });

        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'Acme', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        await testDb.insert(schema.templates).values([
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { id: TPL1, tenantId: TENANT, name: 'Residential', version: 1, schema: { sections: [] } as any, createdAt: new Date() },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { id: TPL2, tenantId: TENANT, name: 'Radon', version: 1, schema: { sections: [] } as any, createdAt: new Date() },
        ]);
        await seedRoleProfiles(testDb as any, TENANT, new Date(1));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('CRITICAL — writes the inherited client to the new sub-inspection', async () => {
        const req = await svc.create(TENANT, {
            clientName: 'Jane Smith', clientEmail: 'jane@example.com',
            propertyAddress: '123 Main St', scheduledAt: '2026-06-15T09:00:00Z',
        }, [{ templateId: TPL1 }]);

        const detail = await svc.addSubInspection(TENANT, req.id, { templateId: TPL2 });
        const newSub = detail.inspections.find(s => s.templateId === TPL2);
        expect(newSub).toBeTruthy();

        const rows = await people.listPeople(TENANT, newSub!.id);
        expect(rows.map(r => r.roleKey)).toEqual(['client']);
        expect(rows[0]?.email).toBe('jane@example.com');

        // Reuses the SAME client contact as the sibling sub-inspection created by create().
        const firstSubRows = await people.listPeople(TENANT, req.inspections[0].id);
        expect(rows[0]?.contactId).toBe(firstSubRows[0]?.contactId);
    });

    it('does not fail addSubInspection when the people-write throws (non-fatal)', async () => {
        const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
        const req = await svc.create(TENANT, {
            clientName: 'Jane Smith', clientEmail: 'jane@example.com',
            propertyAddress: '123 Main St', scheduledAt: '2026-06-15T09:00:00Z',
        }, [{ templateId: TPL1 }]);

        const addPersonSpy = vi.spyOn(PeopleService.prototype, 'addPerson').mockRejectedValue(new Error('boom'));
        const detail = await svc.addSubInspection(TENANT, req.id, { templateId: TPL2 });

        expect(addPersonSpy).toHaveBeenCalled();
        expect(detail.inspections).toHaveLength(2);
        expect(errorSpy).toHaveBeenCalled();
    });
});
