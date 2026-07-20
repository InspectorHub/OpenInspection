/**
 * Task 9c (people-role-profiles) — accessToInspection, listRecommendationsForAgent,
 * and referralsByDay must resolve the buyer's-agent contact via inspection_people
 * (role buyer_agent), not the legacy inspections.referredByAgentId column. Each
 * spec below seeds the inspection with the LEGACY column NULL and only
 * inspection_people populated, so it fails against the pre-rewrite implementation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { accessToInspection, listRecommendationsForAgent, referralsByDay } from '../../../server/services/agent/referral';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { PeopleService } from '../../../server/services/people.service';
import { REPORT_STATUS } from '../../../server/lib/status/report-status';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T1 = '00000000-0000-0000-0000-000000000001';
const AGENT_USER = '00000000-0000-0000-0000-000000000a01';
const OTHER_AGENT_USER = '00000000-0000-0000-0000-000000000a02';
const INSPECTOR_T1 = '00000000-0000-0000-0000-00000000ab01';
const AGENT_CONTACT = 'jane-c1';
const OTHER_CONTACT = 'other-c1';

const roleProfileId = (tenantId: string, key: string) => `crp_${tenantId}_${key}`;

let db: BetterSQLite3Database<typeof schema>;

async function seedCommon() {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await db.insert(schema.tenants).values({
        id: T1, name: 'Acme Inspections', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await seedRoleProfiles(db, T1, new Date(1));
    await db.insert(schema.users).values([
        { id: AGENT_USER, tenantId: null, email: 'jane@realty.com', role: 'agent', name: 'Jane', createdAt: new Date(), passwordHash: 'h' },
        { id: OTHER_AGENT_USER, tenantId: null, email: 'other@realty.com', role: 'agent', name: 'Other', createdAt: new Date(), passwordHash: 'h' },
        { id: INSPECTOR_T1, tenantId: T1, email: 'mike@acme.com', role: 'inspector', name: 'Mike', createdAt: new Date(), passwordHash: 'h' },
    ]);
    await db.insert(schema.contacts).values([
        { id: AGENT_CONTACT, tenantId: T1, type: 'agent', name: 'Jane', email: 'jane@realty.com', createdAt: new Date() },
        { id: OTHER_CONTACT, tenantId: T1, type: 'agent', name: 'Other', email: 'other@realty.com', createdAt: new Date() },
    ]);
    await db.insert(schema.agentTenantLinks).values([
        { id: 'l1', agentUserId: AGENT_USER, tenantId: T1, inspectorContactId: AGENT_CONTACT, status: 'active', createdAt: new Date() },
        { id: 'l2', agentUserId: OTHER_AGENT_USER, tenantId: T1, inspectorContactId: OTHER_CONTACT, status: 'active', createdAt: new Date() },
    ]);
}

describe('accessToInspection — buyer_agent via inspection_people (Task 9c)', () => {
    beforeEach(seedCommon);

    it('legacy referredByAgentId NULL, buyer_agent inspection_people row present — grants access', async () => {
        await db.insert(schema.inspections).values({
            id: 'i-1', tenantId: T1, inspectorId: INSPECTOR_T1, propertyAddress: '1 Main',
            date: '2026-06-01', status: 'confirmed', paymentStatus: 'paid',
            price: 0, referredByAgentId: null, createdAt: new Date(),
        });
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(T1, 'i-1', AGENT_CONTACT, roleProfileId(T1, 'buyer_agent'));

        const result = await accessToInspection({} as D1Database, AGENT_USER, 'i-1');
        expect(result).toEqual({ tenantId: T1 });
    });

    it('no buyer_agent inspection_people row — denies access even with an active link', async () => {
        await db.insert(schema.inspections).values({
            id: 'i-2', tenantId: T1, inspectorId: INSPECTOR_T1, propertyAddress: '2 Oak',
            date: '2026-06-01', status: 'confirmed', paymentStatus: 'paid',
            price: 0, referredByAgentId: null, createdAt: new Date(),
        });
        const result = await accessToInspection({} as D1Database, AGENT_USER, 'i-2');
        expect(result).toBeNull();
    });

    it('other agent\'s buyer_agent row does not grant this agent access', async () => {
        await db.insert(schema.inspections).values({
            id: 'i-3', tenantId: T1, inspectorId: INSPECTOR_T1, propertyAddress: '3 Elm',
            date: '2026-06-01', status: 'confirmed', paymentStatus: 'paid',
            price: 0, referredByAgentId: null, createdAt: new Date(),
        });
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(T1, 'i-3', OTHER_CONTACT, roleProfileId(T1, 'buyer_agent'));

        const result = await accessToInspection({} as D1Database, AGENT_USER, 'i-3');
        expect(result).toBeNull();
    });
});

describe('listRecommendationsForAgent — buyer_agent via inspection_people (Task 9c)', () => {
    beforeEach(seedCommon);

    const templateSnapshot = {
        sections: [{
            id: 'sec1', title: 'Roof', items: [{
                id: 'item1', label: 'Shingles',
                tabs: { defects: [{ id: 'd1', title: 'Missing shingles', category: 'safety', comment: 'default' }] },
            }],
        }],
    };
    const resultsData = { item1: { defects: [{ cannedId: 'd1', included: true }] } };

    it('legacy referredByAgentId NULL, buyer_agent inspection_people row present — surfaces the recommendation', async () => {
        await db.insert(schema.inspections).values({
            id: 'i-1', tenantId: T1, inspectorId: INSPECTOR_T1, propertyAddress: '1 Main',
            date: '2026-06-01', status: 'completed', reportStatus: REPORT_STATUS.PUBLISHED, paymentStatus: 'paid',
            price: 0, referredByAgentId: null, createdAt: new Date(),
            templateSnapshot,
        });
        await db.insert(schema.inspectionResults).values({
            id: 'res-1', tenantId: T1, inspectionId: 'i-1', data: resultsData, lastSyncedAt: new Date(),
        });
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(T1, 'i-1', AGENT_CONTACT, roleProfileId(T1, 'buyer_agent'));

        const groups = await listRecommendationsForAgent({} as D1Database, AGENT_USER);
        expect(groups.safety).toHaveLength(1);
        expect(groups.safety[0].defectTitle).toBe('Missing shingles');
    });

    it('no buyer_agent inspection_people row — excludes the published inspection', async () => {
        await db.insert(schema.inspections).values({
            id: 'i-2', tenantId: T1, inspectorId: INSPECTOR_T1, propertyAddress: '2 Oak',
            date: '2026-06-01', status: 'completed', reportStatus: REPORT_STATUS.PUBLISHED, paymentStatus: 'paid',
            price: 0, referredByAgentId: null, createdAt: new Date(),
            templateSnapshot,
        });
        await db.insert(schema.inspectionResults).values({
            id: 'res-2', tenantId: T1, inspectionId: 'i-2', data: resultsData, lastSyncedAt: new Date(),
        });
        const groups = await listRecommendationsForAgent({} as D1Database, AGENT_USER);
        expect(groups.safety).toHaveLength(0);
    });
});

describe('referralsByDay — buyer_agent via inspection_people (Task 9c)', () => {
    beforeEach(seedCommon);

    it('legacy referredByAgentId NULL, buyer_agent inspection_people row present — counts the day bucket', async () => {
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        await db.insert(schema.inspections).values({
            id: 'i-1', tenantId: T1, inspectorId: INSPECTOR_T1, propertyAddress: '1 Main',
            date: '2026-06-01', status: 'confirmed', paymentStatus: 'paid',
            price: 0, referredByAgentId: null, createdAt: today,
        });
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(T1, 'i-1', AGENT_CONTACT, roleProfileId(T1, 'buyer_agent'));

        const { created } = await referralsByDay({} as D1Database, AGENT_USER, 7);
        expect(created[6]).toBe(1); // today = last index
        expect(created.reduce((a, b) => a + b, 0)).toBe(1);
    });

    it('no buyer_agent inspection_people row — does not count', async () => {
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        await db.insert(schema.inspections).values({
            id: 'i-2', tenantId: T1, inspectorId: INSPECTOR_T1, propertyAddress: '2 Oak',
            date: '2026-06-01', status: 'confirmed', paymentStatus: 'paid',
            price: 0, referredByAgentId: null, createdAt: today,
        });
        const { created } = await referralsByDay({} as D1Database, AGENT_USER, 7);
        expect(created.reduce((a, b) => a + b, 0)).toBe(0);
    });
});
