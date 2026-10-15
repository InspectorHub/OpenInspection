/**
 * What the send-report guards need to find in the database, for specs that drive
 * the inspection routes with stubbed services: the inspection row (report status
 * decides whether a send is allowed) and the people seated on it (recipients must
 * be among them). The services under test stay stubbed; only these two reads are real.
 */
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { MockKV } from '../mocks';

export const guardKv = () => new MockKV() as unknown as KVNamespace;

export async function seedSendGuardFixture(
    db: BetterSQLite3Database<typeof schema>,
    tenantId: string,
    inspectionId: string,
    people: Array<{ contactId: string; roleKey: string }>,
    reportStatus: 'published' | 'in_progress' = 'published',
): Promise<void> {
    const now = new Date();
    await db.insert(schema.inspections).values({
        id: inspectionId, tenantId, propertyAddress: '1 Main St', date: '2026-06-01', status: 'completed',
        paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false, reportStatus, createdAt: now,
    } as never);
    const profiles = await db.select().from(schema.contactRoleProfiles).all();
    for (const p of people) {
        const profile = profiles.find((r) => r.tenantId === tenantId && r.key === p.roleKey);
        if (!profile) throw new Error(`no role profile ${p.roleKey} seeded for ${tenantId}`);
        await db.insert(schema.inspectionPeople).values({
            id: `p-${inspectionId}-${p.contactId}`, tenantId, inspectionId, contactId: p.contactId, roleProfileId: profile.id, createdAt: now,
        } as never);
    }
}
