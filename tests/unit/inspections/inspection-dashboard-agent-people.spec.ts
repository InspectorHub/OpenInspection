/**
 * Task 9c-X3 (people-role-profiles, FINAL reads) — InspectionAnalyticsService
 * .getDashboardBuckets() attributes each dashboard row's `agentName` from
 * inspections.sellingAgentId / .referredByAgentId. Convert to source it from
 * inspection_people (listing_agent = selling agent, buyer_agent = referred
 * agent), not the legacy columns (frozen cache, dropped Task 13).
 *
 * Seeds inspections with the LEGACY agent columns NULL and only
 * inspection_people populated, so this fails against the pre-rewrite
 * implementation (which reads only the legacy columns and would render no
 * agentName).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionAnalyticsService } from '../../../server/services/inspection/inspection-analytics.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-0000000009c3';
const LISTING_AGENT = 'contact-listing-agent-9c3';
const BUYER_AGENT = 'contact-buyer-agent-9c3';
const INSP_LISTING = 'insp-9c3-listing';
const INSP_BUYER = 'insp-9c3-buyer';
const INSP_NONE = 'insp-9c3-none';

const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

const facadeStub = {} as unknown as import('../../../server/services/inspection.service').InspectionService;

function todayStr() {
    return new Date().toISOString().slice(0, 10);
}

describe('InspectionAnalyticsService.getDashboardBuckets — agent attribution via inspection_people (Task 9c-X3)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: InspectionAnalyticsService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        svc = new InspectionAnalyticsService(
            {} as D1Database,
            undefined,
            undefined,
            undefined,
            undefined,
            facadeStub,
        );

        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme-9c3', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(testDb, TENANT, new Date(1));
        await testDb.insert(schema.contacts).values([
            { id: LISTING_AGENT, tenantId: TENANT, type: 'agent', name: 'Lisa Listing', email: 'lisa@realty.example', createdAt: new Date() },
            { id: BUYER_AGENT, tenantId: TENANT, type: 'agent', name: 'Bob Buyer', email: 'bob@realty.example', createdAt: new Date() },
        ]);

        // Legacy sellingAgentId/referredByAgentId columns intentionally NULL —
        // only inspection_people carries agent attribution.
        await testDb.insert(schema.inspections).values([
            {
                id: INSP_LISTING, tenantId: TENANT, propertyAddress: '1 Main St',
                sellingAgentId: null, referredByAgentId: null,
                date: todayStr(), status: 'confirmed', paymentStatus: 'unpaid', price: 10000,
                paymentRequired: false, agreementRequired: false, createdAt: new Date(),
            },
            {
                id: INSP_BUYER, tenantId: TENANT, propertyAddress: '2 Oak Ave',
                sellingAgentId: null, referredByAgentId: null,
                date: todayStr(), status: 'confirmed', paymentStatus: 'unpaid', price: 20000,
                paymentRequired: false, agreementRequired: false, createdAt: new Date(),
            },
            {
                id: INSP_NONE, tenantId: TENANT, propertyAddress: '3 Elm St',
                sellingAgentId: null, referredByAgentId: null,
                date: todayStr(), status: 'confirmed', paymentStatus: 'unpaid', price: 0,
                paymentRequired: false, agreementRequired: false, createdAt: new Date(),
            },
        ]);
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, INSP_LISTING, LISTING_AGENT, roleProfileId('listing_agent'));
        await people.addPerson(TENANT, INSP_BUYER, BUYER_AGENT, roleProfileId('buyer_agent'));
    });

    it('resolves agentName from the listing_agent inspection_people row', async () => {
        const buckets = await svc.getDashboardBuckets(TENANT);
        const row = buckets.today.find(r => r.id === INSP_LISTING);
        expect(row).toBeDefined();
        expect(row!.agentName).toBe('Lisa Listing');
    });

    it('resolves agentName from the buyer_agent inspection_people row when no listing_agent is present', async () => {
        const buckets = await svc.getDashboardBuckets(TENANT);
        const row = buckets.today.find(r => r.id === INSP_BUYER);
        expect(row).toBeDefined();
        expect(row!.agentName).toBe('Bob Buyer');
    });

    it('leaves agentName undefined when no inspection_people agent row exists', async () => {
        const buckets = await svc.getDashboardBuckets(TENANT);
        const row = buckets.today.find(r => r.id === INSP_NONE);
        expect(row).toBeDefined();
        expect(row!.agentName).toBeUndefined();
    });
});
