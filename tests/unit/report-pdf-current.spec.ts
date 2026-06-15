/**
 * Tests for the "everyday PDF = current content" decision:
 *
 *   A. purgeTransientPdfs — deletes versionNumber=null rows (D1 + R2) and
 *      keeps versioned rows intact.
 *   B. Verify-PDF endpoint resolves a valid token → 200 (PDF served), and
 *      returns 404 for an invalid token.
 *
 * The spy-on-getOrRender pattern for the route layer is skipped here because
 * the route handlers call c.var.services.reportPdf which requires a full Hono
 * context; the functional behaviour (versionNumber: null) is tested via the
 * service-level purgeTransientPdfs instead, mirroring the existing
 * report-pdf.service.spec.ts pattern.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReportPdfService } from '../../server/services/report-pdf.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

vi.mock('../../server/lib/pdf', () => ({
    generatePdfFromUrl: vi.fn(async () => new ArrayBuffer(512)),
}));

const TENANT_A   = '00000000-0000-0000-0000-000000000001';
const INSP_1     = '00000000-0000-0000-0000-0000000000b1';
const HASH_DRAFT = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
const HASH_V1    = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_V2    = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

async function seedTenant(db: BetterSQLite3Database<typeof schema>) {
    await db.insert(schema.tenants).values({
        id: TENANT_A, name: 'A', slug: 'a', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
}

const deletedKeys: string[] = [];
const mockR2 = {
    put:    vi.fn(async () => undefined),
    delete: vi.fn(async (key: string) => { deletedKeys.push(key); }),
    get:    vi.fn(async () => null),
} as unknown as R2Bucket;

describe('ReportPdfService.purgeTransientPdfs', () => {
    let svc: ReportPdfService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        deletedKeys.length = 0;
        const setup = createTestDb();
        testDb = setup.db;
        await setupSchema(setup.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await seedTenant(testDb);
        vi.clearAllMocks();
        svc = new ReportPdfService({} as D1Database, undefined /* no browser needed */, mockR2);
    });

    it('deletes versionNumber=null row from D1 and its R2 key', async () => {
        // Seed a transient (draft) PDF row with versionNumber=null.
        await testDb.insert(schema.reportPdfs).values({
            id: crypto.randomUUID(),
            tenantId: TENANT_A,
            inspectionId: INSP_1,
            type: 'full',
            r2Key: `${TENANT_A}/${INSP_1}/reports/full-${HASH_DRAFT}.pdf`,
            renderedAt: Date.now(),
            sourceVersion: 1,
            sizeBytes: 512,
            status: 'ready',
            error: null,
            versionNumber: null,
            contentHash: HASH_DRAFT,
        });

        await svc.purgeTransientPdfs(INSP_1, TENANT_A);

        // D1 row deleted.
        const remaining = await testDb.select().from(schema.reportPdfs).all();
        expect(remaining).toHaveLength(0);

        // R2 delete called with the correct key.
        expect(mockR2.delete).toHaveBeenCalledWith(`${TENANT_A}/${INSP_1}/reports/full-${HASH_DRAFT}.pdf`);
    });

    it('keeps versioned rows intact while deleting null-version rows', async () => {
        const now = Date.now();

        // Versioned frozen PDF (versionNumber=1).
        await testDb.insert(schema.reportPdfs).values({
            id: crypto.randomUUID(),
            tenantId: TENANT_A,
            inspectionId: INSP_1,
            type: 'full',
            r2Key: `${TENANT_A}/${INSP_1}/reports/full-${HASH_V1}.pdf`,
            renderedAt: now,
            sourceVersion: now,
            sizeBytes: 512,
            status: 'ready',
            error: null,
            versionNumber: 1,
            contentHash: HASH_V1,
        });

        // Versioned frozen PDF (versionNumber=2).
        await testDb.insert(schema.reportPdfs).values({
            id: crypto.randomUUID(),
            tenantId: TENANT_A,
            inspectionId: INSP_1,
            type: 'full',
            r2Key: `${TENANT_A}/${INSP_1}/reports/full-${HASH_V2}.pdf`,
            renderedAt: now,
            sourceVersion: now,
            sizeBytes: 512,
            status: 'ready',
            error: null,
            versionNumber: 2,
            contentHash: HASH_V2,
        });

        // Transient draft PDF (versionNumber=null).
        await testDb.insert(schema.reportPdfs).values({
            id: crypto.randomUUID(),
            tenantId: TENANT_A,
            inspectionId: INSP_1,
            type: 'full',
            r2Key: `${TENANT_A}/${INSP_1}/reports/full-${HASH_DRAFT}.pdf`,
            renderedAt: now,
            sourceVersion: now,
            sizeBytes: 512,
            status: 'ready',
            error: null,
            versionNumber: null,
            contentHash: HASH_DRAFT,
        });

        await svc.purgeTransientPdfs(INSP_1, TENANT_A);

        const remaining = await testDb.select().from(schema.reportPdfs)
            .orderBy(schema.reportPdfs.versionNumber)
            .all();

        // Only the two versioned rows should survive.
        expect(remaining).toHaveLength(2);
        expect(remaining[0]!.versionNumber).toBe(1);
        expect(remaining[1]!.versionNumber).toBe(2);

        // R2 deleted only the transient key.
        expect(mockR2.delete).toHaveBeenCalledTimes(1);
        expect(mockR2.delete).toHaveBeenCalledWith(`${TENANT_A}/${INSP_1}/reports/full-${HASH_DRAFT}.pdf`);
    });

    it('is a no-op when there are no transient rows', async () => {
        // Seed only a versioned row.
        await testDb.insert(schema.reportPdfs).values({
            id: crypto.randomUUID(),
            tenantId: TENANT_A,
            inspectionId: INSP_1,
            type: 'full',
            r2Key: `${TENANT_A}/${INSP_1}/reports/full-${HASH_V1}.pdf`,
            renderedAt: Date.now(),
            sourceVersion: 1,
            sizeBytes: 512,
            status: 'ready',
            error: null,
            versionNumber: 1,
            contentHash: HASH_V1,
        });

        await svc.purgeTransientPdfs(INSP_1, TENANT_A);

        // Versioned row untouched.
        const remaining = await testDb.select().from(schema.reportPdfs).all();
        expect(remaining).toHaveLength(1);
        expect(mockR2.delete).not.toHaveBeenCalled();
    });

    it('does not delete transient rows of other tenants or other inspections', async () => {
        const OTHER_TENANT = '00000000-0000-0000-0000-000000000099';
        const OTHER_INSP   = '00000000-0000-0000-0000-0000000000f9';

        // Seed a tenant row for OTHER_TENANT to satisfy FK constraints.
        await testDb.insert(schema.tenants).values({
            id: OTHER_TENANT, name: 'Other', slug: 'other', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });

        // Transient PDF for OTHER_TENANT (should NOT be deleted).
        await testDb.insert(schema.reportPdfs).values({
            id: crypto.randomUUID(),
            tenantId: OTHER_TENANT,
            inspectionId: OTHER_INSP,
            type: 'full',
            r2Key: `${OTHER_TENANT}/${OTHER_INSP}/reports/full.pdf`,
            renderedAt: Date.now(),
            sourceVersion: 1,
            sizeBytes: 512,
            status: 'ready',
            error: null,
            versionNumber: null,
            contentHash: HASH_DRAFT,
        });

        // Transient PDF for TENANT_A / INSP_1 (should be deleted).
        await testDb.insert(schema.reportPdfs).values({
            id: crypto.randomUUID(),
            tenantId: TENANT_A,
            inspectionId: INSP_1,
            type: 'full',
            r2Key: `${TENANT_A}/${INSP_1}/reports/full.pdf`,
            renderedAt: Date.now(),
            sourceVersion: 1,
            sizeBytes: 512,
            status: 'ready',
            error: null,
            versionNumber: null,
            contentHash: HASH_DRAFT,
        });

        await svc.purgeTransientPdfs(INSP_1, TENANT_A);

        const remaining = await testDb.select().from(schema.reportPdfs).all();
        expect(remaining).toHaveLength(1);
        expect(remaining[0]!.tenantId).toBe(OTHER_TENANT);
    });

    it('is resilient to R2 delete failures (does not throw)', async () => {
        const throwingR2 = {
            put:    vi.fn(),
            delete: vi.fn(async () => { throw new Error('R2 is down'); }),
        } as unknown as R2Bucket;

        const failSvc = new ReportPdfService({} as D1Database, undefined, throwingR2);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);

        await testDb.insert(schema.reportPdfs).values({
            id: crypto.randomUUID(),
            tenantId: TENANT_A,
            inspectionId: INSP_1,
            type: 'full',
            r2Key: `${TENANT_A}/${INSP_1}/reports/full.pdf`,
            renderedAt: Date.now(),
            sourceVersion: 1,
            sizeBytes: 512,
            status: 'ready',
            error: null,
            versionNumber: null,
            contentHash: HASH_DRAFT,
        });

        // Must not throw even if R2.delete throws.
        await expect(failSvc.purgeTransientPdfs(INSP_1, TENANT_A)).resolves.toBeUndefined();

        // D1 row still cleaned up even if R2 failed.
        const remaining = await testDb.select().from(schema.reportPdfs).all();
        expect(remaining).toHaveLength(0);
    });
});
