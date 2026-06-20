import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export const TENANT_A = '00000000-0000-0000-0000-000000000001';
export const INSP_ID  = '00000000-0000-0000-0000-000000000010';
export const AGR_ID   = '00000000-0000-0000-0000-000000000020';

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
}
