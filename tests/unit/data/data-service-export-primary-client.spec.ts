/**
 * Task 9c (people-role-profiles) — DataService.exportInspectionsCSV projects
 * client_name/client_email/client_phone straight off the legacy inspections
 * columns into the CSV export. Convert to source these from the
 * inspection_people primary-client join (PeopleService), not the legacy
 * columns (frozen cache, dropped Task 13), via a single LEFT JOIN so the
 * bulk export stays N+1-free. Column order/shape must be unchanged.
 *
 * Seeds inspections with the LEGACY client columns NULL and only
 * inspection_people populated, so this fails against the old implementation
 * (which reads only the legacy columns and would render empty client cells).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DataService } from '../../../server/services/data.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { asD1Db } from '../helpers/test-db';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { lazyD1 } from '../helpers/d1-binding';
const testD1 = lazyD1();

const TENANT = '00000000-0000-0000-0000-000000000e1';
const CLIENT = 'contact-client-export';
const INSP_WITH_CLIENT = 'insp-export-1';
const INSP_NO_CLIENT = 'insp-export-2';

const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

describe('DataService.exportInspectionsCSV — primary-client sourcing (Task 9c)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let svc: DataService;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        testD1.use(db);
        svc = new DataService(testD1.binding);

        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'acme-export', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(asD1Db(db), TENANT, new Date(1));
        await db.insert(schema.contacts).values({
            id: CLIENT, tenantId: TENANT, type: 'client', name: 'Jane Client',
            email: 'jane@example.com', phone: '+15551234567', createdAt: new Date(),
        });

        // The legacy clientName/clientEmail/clientPhone columns are GONE
        // (schema/inspection/core.ts): only inspection_people carries the primary
        // client for INSP_WITH_CLIENT; INSP_NO_CLIENT has neither (degenerate —
        // no primary client at all).
        await db.insert(schema.inspections).values([
            {
                id: INSP_WITH_CLIENT, tenantId: TENANT, propertyAddress: '1 Main St',
                date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 50000,
                paymentRequired: false, agreementRequired: false, createdAt: new Date(),
            },
            {
                id: INSP_NO_CLIENT, tenantId: TENANT, propertyAddress: '2 Oak Ave',
                date: '2026-06-02', status: 'requested', paymentStatus: 'unpaid', price: 0,
                paymentRequired: false, agreementRequired: false, createdAt: new Date(),
            },
        ]);
        const people = new PeopleService({ DB: testD1.binding });
        await people.addPerson(TENANT, INSP_WITH_CLIENT, CLIENT, roleProfileId('client'));
    });

    it('sources client_name/client_email/client_phone from the inspection_people primary-client join, preserving column order', async () => {
        const csv = await svc.exportInspectionsCSV(TENANT);
        const [header, ...rows] = csv.split('\n');
        expect(header.split(',').slice(0, 7)).toEqual([
            'id', 'date', 'property_address', 'unit', 'client_name', 'client_email', 'client_phone',
        ]);

        const withClientRow = rows.find(r => r.startsWith(INSP_WITH_CLIENT));
        expect(withClientRow).toContain('Jane Client');
        expect(withClientRow).toContain('jane@example.com');
        expect(withClientRow).toContain('+15551234567');

        const noClientRow = rows.find(r => r.startsWith(INSP_NO_CLIENT));
        // id,date,property_address,unit,client_name,client_email,client_phone,...
        const cols = noClientRow!.split(',');
        expect(cols[4]).toBe(''); // client_name empty, no legacy-column fallback
        expect(cols[5]).toBe('');
        expect(cols[6]).toBe('');
    });
});
