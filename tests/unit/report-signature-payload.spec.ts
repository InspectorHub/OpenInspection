/**
 * TDD: report-signature-payload
 *
 * Verifies that getReportData surfaces `signature`, `verification`, and
 * `isPublished` fields so the report page (and later PDF layer) can render
 * an inspector signature block + cryptographic verification QR without
 * additional round-trips.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionService } from '../../server/services/inspection.service';
import { ReportVersionService } from '../../server/services/report-version.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT     = 'aa000000-0000-0000-0000-000000000001';
const INSPECTOR  = 'bb000000-0000-0000-0000-000000000002';
const INSPECTION = 'cc000000-0000-0000-0000-000000000003';

async function seedBase(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await testDb.insert(schema.users).values({
        id:           INSPECTOR,
        tenantId:     TENANT,
        email:        'inspector@example.com',
        passwordHash: 'x',
        name:         'Alice Inspector',
        licenseNumber: 'LIC-9999',
        role:         'inspector',
        createdAt:    new Date(),
    });
    await testDb.insert(schema.inspections).values({
        id:              INSPECTION,
        tenantId:        TENANT,
        inspectorId:     INSPECTOR,
        propertyAddress: '1 Main St',
        date:            '2026-06-01',
        status:          'completed',
        reportStatus:    'in_progress',   // default — tests may override
        paymentStatus:   'unpaid',
        price:           0,
        paymentRequired: false,
        agreementRequired: false,
        createdAt:       new Date(),
    });
}

describe('getReportData — signature + verification payload (layer 2)', () => {
    let svc: InspectionService;
    let versionSvc: ReportVersionService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new InspectionService({} as D1Database);
        versionSvc = new ReportVersionService({} as D1Database, 'test-secret-key-long-enough-16');
        await seedBase(testDb);
    });

    // ------------------------------------------------------------------ //
    // Case 1: published + signed + version row present
    // ------------------------------------------------------------------ //
    it('published+signed inspection returns signature and verification metadata', async () => {
        // Set reportStatus to published
        await testDb.update(schema.inspections)
            .set({ reportStatus: 'published' })
            .where(
                // drizzle/better-sqlite3 shares the same eq from drizzle-orm
                (await import('drizzle-orm')).eq(schema.inspections.id, INSPECTION),
            );

        // Seed inspection_results with _inspector_signature
        await testDb.insert(schema.inspectionResults).values({
            id:           'res-001',
            tenantId:     TENANT,
            inspectionId: INSPECTION,
            data:         {
                _inspector_signature: {
                    signatureBase64: 'data:image/png;base64,abc123',
                    signedAt:        1718000000000,
                    userId:          INSPECTOR,
                    auto:            true,
                },
            } as unknown as object,
            lastSyncedAt: new Date(),
        });

        // Create a report version row via the service
        await versionSvc.snapshotOnPublish(TENANT, INSPECTION, INSPECTOR);

        const data = await svc.getReportData(INSPECTION, TENANT);

        // isPublished
        expect((data as unknown as Record<string, unknown>).isPublished).toBe(true);

        // signature block
        const sig = (data as unknown as Record<string, unknown>).signature as Record<string, unknown> | null;
        expect(sig).not.toBeNull();
        expect(sig!.signatureBase64).toBe('data:image/png;base64,abc123');
        expect(sig!.inspectorName).toBeTruthy();        // 'Alice Inspector'
        expect(sig!.inspectorLicense).toBe('LIC-9999');
        expect(sig!.signedAt).toBe(1718000000000);

        // verification block
        const ver = (data as unknown as Record<string, unknown>).verification as Record<string, unknown> | null;
        expect(ver).not.toBeNull();
        expect((ver!.versionNumber as number)).toBeGreaterThan(0);
        expect(ver!.verifyToken).toBeTruthy();
        expect(ver!.contentHash).toBeTruthy();
        expect(typeof ver!.publishedAt).toBe('number');
    });

    // ------------------------------------------------------------------ //
    // Case 2: draft (in_progress) → everything null
    // ------------------------------------------------------------------ //
    it('draft inspection returns isPublished=false, signature=null, verification=null', async () => {
        // reportStatus stays 'in_progress' (seeded default)
        await testDb.insert(schema.inspectionResults).values({
            id:           'res-002',
            tenantId:     TENANT,
            inspectionId: INSPECTION,
            data:         {} as object,
            lastSyncedAt: new Date(),
        });

        const data = await svc.getReportData(INSPECTION, TENANT);

        expect((data as unknown as Record<string, unknown>).isPublished).toBe(false);
        expect((data as unknown as Record<string, unknown>).signature).toBeNull();
        expect((data as unknown as Record<string, unknown>).verification).toBeNull();
    });

    // ------------------------------------------------------------------ //
    // Case 3: published but no _inspector_signature image → typed fallback
    // ------------------------------------------------------------------ //
    it('published without signature image returns signatureBase64=null but inspectorName truthy', async () => {
        await testDb.update(schema.inspections)
            .set({ reportStatus: 'published' })
            .where(
                (await import('drizzle-orm')).eq(schema.inspections.id, INSPECTION),
            );

        // results row without _inspector_signature
        await testDb.insert(schema.inspectionResults).values({
            id:           'res-003',
            tenantId:     TENANT,
            inspectionId: INSPECTION,
            data:         {} as object,
            lastSyncedAt: new Date(),
        });

        await versionSvc.snapshotOnPublish(TENANT, INSPECTION, INSPECTOR);

        const data = await svc.getReportData(INSPECTION, TENANT);

        expect((data as unknown as Record<string, unknown>).isPublished).toBe(true);

        const sig = (data as unknown as Record<string, unknown>).signature as Record<string, unknown> | null;
        expect(sig).not.toBeNull();
        expect(sig!.signatureBase64).toBeNull();
        expect(sig!.inspectorName).toBeTruthy();   // falls back to name from users row

        // verification still present
        const ver = (data as unknown as Record<string, unknown>).verification as Record<string, unknown> | null;
        expect(ver).not.toBeNull();
        expect(ver!.verifyToken).toBeTruthy();
    });
});
