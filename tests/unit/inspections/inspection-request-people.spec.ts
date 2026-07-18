/**
 * Task 7b (people-role-profiles) — InspectionRequestService.create inserts
 * `inspections` directly (not via InspectionCoreService.createInspection,
 * which already got the Task 7 people-write). Mirror the agent referral
 * (input.referredByAgentId, already stamped onto every sub-inspection's
 * referredByAgentId column) into inspection_people (buyer_agent) for EACH
 * created sub-inspection, non-fatal like Task 7.
 *
 * No resolved client contact id is available in this service — clientName /
 * clientEmail stay inline strings on `inspection_requests` / `inspections`,
 * with no contact-upsert anywhere in this file — so only buyer_agent is
 * written.
 *
 * addSubInspection() is NOT covered here: its CreateSubInspectionInput
 * carries no agent/client contact id at all (the insert doesn't set
 * referredByAgentId), so there is nothing to confidently resolve at that
 * call site.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
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

describe('InspectionRequestService.create — writes inspection_people (Task 7b)', () => {
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

    it('writes buyer_agent to EVERY sub-inspection created in one request', async () => {
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
            expect(rows.map(r => r.roleKey)).toEqual(['buyer_agent']);
            expect(rows[0].contactId).toBe(AGENT_CONTACT);
        }
    });

    it('writes nothing when the request carries no agent referral', async () => {
        const result = await svc.create(TENANT, {
            clientName:      'Jane Smith',
            propertyAddress: '123 Main St',
            scheduledAt:     '2026-06-15T09:00:00Z',
        }, [{ templateId: TPL1 }]);

        const rows = await people.listPeople(TENANT, result.inspections[0].id);
        expect(rows).toEqual([]);
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
