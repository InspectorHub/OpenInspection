import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';

export const TENANT_A = '00000000-0000-0000-0000-000000000001';
export const INSP_ID  = '00000000-0000-0000-0000-000000000010';
export const AGR_ID   = '00000000-0000-0000-0000-000000000020';
export const CLIENT_CONTACT_ID = '00000000-0000-0000-0000-0000000000c1';

export async function seedBase(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values([
        { id: TENANT_A, name: 'A', slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    ]);
    await testDb.insert(schema.inspections).values([
        { id: INSP_ID, tenantId: TENANT_A, propertyAddress: '1 Main St', clientName: 'Jane', clientEmail: 'jane@test.com', date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 50000, agreementRequired: true, paymentRequired: false, createdAt: new Date() },
    ]);
    await testDb.insert(schema.agreements).values([
        { id: AGR_ID, tenantId: TENANT_A, name: 'Standard Agreement', content: 'Agreement text...', version: 1, createdAt: new Date() },
    ]);
    // Task 9b (people-role-profiles) — the default-signer resolution now reads
    // the inspection_people primary-client join (PeopleService.getPrimaryClient)
    // instead of the legacy inspection.clientName/.clientEmail columns above.
    // Seed a matching contact + primary-client role so specs that rely on the
    // no-opts default signer being "Jane" / "jane@test.com" keep passing.
    await seedRoleProfiles(testDb, TENANT_A, new Date(1));
    await testDb.insert(schema.contacts).values([
        { id: CLIENT_CONTACT_ID, tenantId: TENANT_A, type: 'client', name: 'Jane', email: 'jane@test.com', createdAt: new Date() },
    ]);
    await testDb.insert(schema.inspectionPeople).values([
        {
            id: `ip_${INSP_ID}_client`, tenantId: TENANT_A, inspectionId: INSP_ID,
            contactId: CLIENT_CONTACT_ID, roleProfileId: `crp_${TENANT_A}_client`, createdAt: new Date(),
        },
    ]);
}
