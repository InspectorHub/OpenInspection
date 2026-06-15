import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../server/lib/db/schema';
import { createTestDb, setupSchema } from './db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { InspectionService } from '../../server/services/inspection.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000300';
const INSP_ID = '00000000-0000-0000-0000-000000000010';
const SAVED_SIG = 'data:image/png;base64,SAVEDSIG';

const PUBLISH_OPTS = {
    theme: 'default',
    notifyClient: false,
    notifyAgent: false,
    requireSignature: false,
    requirePayment: false,
};

describe('InspectionService.publishInspection auto-sign behavior', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let svc: InspectionService;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, name: 'A', slug: 's', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.users).values({
            id: USER_ID, tenantId: TENANT, email: 'i@x', passwordHash: 'x',
            role: 'inspector',
            defaultSignatureBase64: SAVED_SIG,
            createdAt: new Date(),
        });
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT,
            inspectorId: USER_ID,
            propertyAddress: '1 Main St', clientName: 'Jane', clientEmail: 'jane@x',
            date: '2026-06-01', status: 'completed',
            paymentStatus: 'unpaid', price: 50000,
            agreementRequired: false, paymentRequired: false,
            autoSignOnPublish: true,
            createdAt: new Date(),
        });
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        svc = new InspectionService({} as D1Database);
    });

    it('writes _inspector_signature when autoSignOnPublish is true and user has saved sig', async () => {
        await svc.publishInspection(INSP_ID, TENANT, PUBLISH_OPTS);
        const row = await db.select().from(schema.inspectionResults)
            .where(eq(schema.inspectionResults.inspectionId, INSP_ID)).get();
        const data = (row?.data as Record<string, unknown>) ?? {};
        const sig = data._inspector_signature as { signatureBase64?: string; userId?: string; auto?: boolean } | undefined;
        expect(sig?.signatureBase64).toBe(SAVED_SIG);
        expect(sig?.userId).toBe(USER_ID);
        expect(sig?.auto).toBe(true);
    });

    it('skips silently when autoSignOnPublish is false', async () => {
        await db.update(schema.inspections).set({ autoSignOnPublish: false }).where(eq(schema.inspections.id, INSP_ID));
        await svc.publishInspection(INSP_ID, TENANT, PUBLISH_OPTS);
        const row = await db.select().from(schema.inspectionResults)
            .where(eq(schema.inspectionResults.inspectionId, INSP_ID)).get();
        const data = (row?.data as Record<string, unknown>) ?? {};
        expect((data as any)._inspector_signature).toBeUndefined();
    });

    it('skips silently when user has no defaultSignatureBase64', async () => {
        await db.update(schema.users).set({ defaultSignatureBase64: null }).where(eq(schema.users.id, USER_ID));
        await svc.publishInspection(INSP_ID, TENANT, PUBLISH_OPTS);
        const row = await db.select().from(schema.inspectionResults)
            .where(eq(schema.inspectionResults.inspectionId, INSP_ID)).get();
        const data = (row?.data as Record<string, unknown>) ?? {};
        expect((data as any)._inspector_signature).toBeUndefined();
    });
});
