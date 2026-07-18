/**
 * Task 9c (people-role-profiles) — InspectionCoreService.getInspection /
 * .listInspections must source clientName/clientEmail/clientPhone from the
 * inspection_people primary-client join (PeopleService.getPrimaryClient),
 * not the legacy inspections.client_name/_email/_phone columns (frozen
 * cache, dropped Task 13). Hard cutover, no legacy-column fallback — mirrors
 * the pattern already used across this branch (e.g. invoices.ts
 * requestPaymentRoute, agreements.ts, publish.ts).
 *
 * Both specs seed inspections with the LEGACY client columns NULL and only
 * inspection_people populated, so they fail against the old implementation
 * (which reads only the legacy columns and would return null/undefined).
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

const T1 = 't1-core-reads';
const CLIENT = 'contact-client-core-reads';
const INSP_WITH_CLIENT = 'insp-core-reads-1';
const INSP_NO_CLIENT = 'insp-core-reads-2';

const roleProfileId = (key: string) => `crp_${T1}_${key}`;

describe('InspectionCoreService.getInspection / .listInspections — primary-client sourcing (Task 9c)', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);

        await db.insert(schema.tenants).values([
            { id: T1, name: 'Tenant One', slug: T1, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        await seedRoleProfiles(db, T1, new Date(1));
        await db.insert(schema.contacts).values({
            id: CLIENT, tenantId: T1, type: 'client', name: 'Jane Client',
            email: 'jane@example.com', phone: '+15551234567', createdAt: new Date(),
        });

        // Legacy client columns are intentionally NULL — only inspection_people
        // carries the primary client for INSP_WITH_CLIENT; INSP_NO_CLIENT has
        // neither (degenerate — no primary client at all).
        await db.insert(schema.inspections).values([
            {
                id: INSP_WITH_CLIENT, tenantId: T1, propertyAddress: '1 Main St',
                clientName: null, clientEmail: null, clientPhone: null,
                date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 0,
                paymentRequired: false, agreementRequired: false, createdAt: new Date(),
            },
            {
                id: INSP_NO_CLIENT, tenantId: T1, propertyAddress: '2 Oak Ave',
                clientName: null, clientEmail: null, clientPhone: null,
                date: '2026-06-02', status: 'requested', paymentStatus: 'unpaid', price: 0,
                paymentRequired: false, agreementRequired: false, createdAt: new Date(),
            },
        ]);

        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(T1, INSP_WITH_CLIENT, CLIENT, roleProfileId('client'));
    });

    function makeSvc() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sdb = new ScopedDB(db as any, T1);
        return new InspectionCoreService({} as D1Database, undefined, sdb);
    }

    describe('getInspection', () => {
        it('sources clientName/clientEmail/clientPhone from the inspection_people primary-client join', async () => {
            const svc = makeSvc();
            const { inspection } = await svc.getInspection(INSP_WITH_CLIENT, T1);
            expect(inspection.clientName).toBe('Jane Client');
            expect(inspection.clientEmail).toBe('jane@example.com');
            expect((inspection as { clientPhone?: string | null }).clientPhone).toBe('+15551234567');
        });

        it('no primary client at all — clientName/clientEmail/clientPhone are null (no legacy-column fallback)', async () => {
            const svc = makeSvc();
            const { inspection } = await svc.getInspection(INSP_NO_CLIENT, T1);
            expect(inspection.clientName).toBeNull();
            expect(inspection.clientEmail).toBeNull();
            expect((inspection as { clientPhone?: string | null }).clientPhone).toBeNull();
        });
    });

    describe('listInspections', () => {
        it('sources each row\'s clientName/clientEmail from the inspection_people primary-client join (single LEFT JOIN, not N+1)', async () => {
            const svc = makeSvc();
            const { inspections } = await svc.listInspections(T1, { limit: 20 });
            expect(inspections).toHaveLength(2);

            const withClient = inspections.find(i => i.id === INSP_WITH_CLIENT);
            expect(withClient?.clientName).toBe('Jane Client');
            expect(withClient?.clientEmail).toBe('jane@example.com');

            const withoutClient = inspections.find(i => i.id === INSP_NO_CLIENT);
            expect(withoutClient?.clientName).toBeNull();
            expect(withoutClient?.clientEmail).toBeNull();
        });

        it('free-text search matches a client name that lives ONLY in inspection_people (no legacy inspections.client_name column)', async () => {
            const svc = makeSvc();
            // "Jane Client" is seeded exclusively via inspection_people ->
            // contacts (INSP_WITH_CLIENT's legacy clientName column is NULL) —
            // search must still find it via the primary-client join, not the
            // frozen legacy column.
            const { inspections } = await svc.listInspections(T1, { limit: 20, search: 'Jane' });
            expect(inspections.map(i => i.id)).toEqual([INSP_WITH_CLIENT]);

            const noMatch = await svc.listInspections(T1, { limit: 20, search: 'Nobody Named This' });
            expect(noMatch.inspections).toHaveLength(0);

            // Address search on the same predicate keeps working alongside it.
            const byAddress = await svc.listInspections(T1, { limit: 20, search: 'Oak Ave' });
            expect(byAddress.inspections.map(i => i.id)).toEqual([INSP_NO_CLIENT]);
        });
    });
});
