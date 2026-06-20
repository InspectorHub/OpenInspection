import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export const TENANT = '00000000-0000-0000-0000-0000000000a1';

// A stub InspectionService.getObserveProgress — returns the FULL observe shape
// (address/date/inspectorName/status + named sections). hubOverview sums
// totalItems/completedItems; observeProgress returns the whole object.
export const inspStub = {
    getObserveProgress: async () => ({
        address: 'Stub St',
        date: '2026-06-01',
        inspectorName: 'Stub Inspector',
        status: 'in_progress',
        sections: [
            { name: 'Roof', totalItems: 5, completedItems: 2 },
            { name: 'Foundation', totalItems: 3, completedItems: 3 },
        ],
    }),
};

export async function seedInspection(
    testDb: BetterSQLite3Database<typeof schema>,
    id: string,
    overrides: Partial<typeof schema.inspections.$inferInsert> = {},
) {
    await testDb.insert(schema.inspections).values({
        id,
        tenantId: TENANT,
        propertyAddress: `${id} Main St`,
        date: '2026-06-01',
        status: 'requested',
        reportStatus: 'in_progress',
        paymentStatus: 'unpaid',
        createdAt: new Date(),
        ...overrides,
    });
}

export async function seedToken(
    testDb: BetterSQLite3Database<typeof schema>,
    inspectionId: string,
    recipientEmail: string,
    role: 'client' | 'co_client' | 'agent' = 'client',
    revokedAt: number | null = null,
    expiresAt: number | null = null,
) {
    await testDb.insert(schema.inspectionAccessTokens).values({
        id: crypto.randomUUID(),
        tenantId: TENANT,
        inspectionId,
        recipientEmail,
        role,
        token: crypto.randomUUID(),
        createdAt: Date.now(),
        expiresAt,
        revokedAt,
    });
}
