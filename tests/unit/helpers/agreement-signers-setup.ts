import * as schema from '../../../server/lib/db/schema';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { asD1Db, type TestDb } from './test-db';

export const TENANT_A = '00000000-0000-0000-0000-000000000001';
export const INSP_ID  = '00000000-0000-0000-0000-000000000010';
export const AGR_ID   = '00000000-0000-0000-0000-000000000020';
export const CLIENT_CONTACT_ID = '00000000-0000-0000-0000-0000000000c1';

export async function seedBase(testDb: TestDb) {
    await testDb.insert(schema.tenants).values([
        { id: TENANT_A, name: 'A', slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    ]);
    // NB: no clientName/clientEmail here — those columns were DROPPED from
    // `inspections` (see schema/inspection/core.ts); WHO is the
    // inspection_people rows seeded below.
    await testDb.insert(schema.inspections).values([
        { id: INSP_ID, tenantId: TENANT_A, propertyAddress: '1 Main St', date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 50000, agreementRequired: true, paymentRequired: false, createdAt: new Date() },
    ]);
    await testDb.insert(schema.agreements).values([
        { id: AGR_ID, tenantId: TENANT_A, name: 'Standard Agreement', content: 'Agreement text...', version: 1, createdAt: new Date() },
    ]);
    // Task 9b (people-role-profiles) — the default-signer resolution now reads
    // the inspection_people primary-client join (PeopleService.getPrimaryClient)
    // instead of the legacy inspection.clientName/.clientEmail columns above.
    // Seed a matching contact + primary-client role so specs that rely on the
    // no-opts default signer being "Jane" / "jane@test.com" keep passing.
    await seedRoleProfiles(asD1Db(testDb), TENANT_A, new Date(1));
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
