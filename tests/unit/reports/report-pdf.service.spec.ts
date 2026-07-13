import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReportPdfService } from '../../../server/services/report-pdf.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

vi.mock('../../../server/lib/pdf', () => ({
    generatePdfFromUrl: vi.fn(async () => new ArrayBuffer(1024)),
    generatePdfWithTocPages: vi.fn(async () => new ArrayBuffer(4096)),
}));
import { generatePdfFromUrl, generatePdfWithTocPages } from '../../../server/lib/pdf';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const INSP_1   = '00000000-0000-0000-0000-0000000000b1';

async function seed(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values({
        id: TENANT_A, name: 'A', slug: 'a', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
}

const mockBrowser = { fetch: vi.fn() } as unknown as Fetcher;
const mockR2 = { put: vi.fn(async () => undefined) } as unknown as R2Bucket;

describe('ReportPdfService', () => {
    let svc: ReportPdfService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        await setupSchema(setup.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await seed(testDb);
        svc = new ReportPdfService({} as D1Database, mockBrowser, mockR2);
        vi.clearAllMocks();
        // The service always renders through generatePdfWithTocPages (it
        // self-short-circuits to a single pass when there are no anchors).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (generatePdfWithTocPages as any).mockResolvedValue(new ArrayBuffer(2048));
    });

    it('returns null when no PDF record exists', async () => {
        const result = await svc.getPdfRecord(INSP_1, TENANT_A, 'full');
        expect(result).toBeNull();
    });

    it('renderAndStore writes R2 key + DB row + returns ready record', async () => {
        const rec = await svc.renderAndStore(INSP_1, TENANT_A, 'full', {
            reportUrl: 'https://example.com/report/insp-1',
            sourceVersion: 1730000000,
        });
        // PHOTOS+REPORTS consolidated into one bucket (commit 1448871):
        // report PDFs key under a reports/ subpath to avoid colliding with
        // inspection photos in the shared bucket.
        expect(rec.r2Key).toBe(`${TENANT_A}/${INSP_1}/reports/full.pdf`);
        expect(rec.status).toBe('ready');
        expect(rec.sizeBytes).toBe(2048);
        expect(mockR2.put).toHaveBeenCalledWith(rec.r2Key, expect.any(ArrayBuffer));
    });

    it('summary type appends ?summary=1 to render URL', async () => {
        await svc.renderAndStore(INSP_1, TENANT_A, 'summary', {
            reportUrl: 'https://example.com/report/insp-1',
            sourceVersion: 1,
        });
        // No footer passed in this path → third arg is undefined (footer is optional).
        expect(generatePdfWithTocPages).toHaveBeenCalledWith(
            mockBrowser,
            'https://example.com/report/insp-1?summary=1',
            undefined,
        );
    });

    it('renderAndStore is idempotent — re-render replaces existing row', async () => {
        await svc.renderAndStore(INSP_1, TENANT_A, 'full', { reportUrl: 'u1', sourceVersion: 1 });
        await svc.renderAndStore(INSP_1, TENANT_A, 'full', { reportUrl: 'u2', sourceVersion: 2 });
        const rows = await testDb.select().from(schema.reportPdfs).all();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.sourceVersion).toBe(2);
    });

    it('isStale returns true when record predates inspection update', async () => {
        const rec = await svc.renderAndStore(INSP_1, TENANT_A, 'full', { reportUrl: 'u', sourceVersion: 100 });
        expect(svc.isStale(rec, 200)).toBe(true);
        expect(svc.isStale(rec, 100)).toBe(false);
    });

    it('throws when BROWSER binding is absent', async () => {
        const noRender = new ReportPdfService({} as D1Database, undefined, mockR2);
        await expect(
            noRender.renderAndStore(INSP_1, TENANT_A, 'full', { reportUrl: 'u', sourceVersion: 1 })
        ).rejects.toThrow(/BROWSER binding/);
    });

    it('throws when REPORTS bucket binding is absent', async () => {
        const noStore = new ReportPdfService({} as D1Database, mockBrowser, undefined);
        await expect(
            noStore.renderAndStore(INSP_1, TENANT_A, 'full', { reportUrl: 'u', sourceVersion: 1 })
        ).rejects.toThrow(/storage bucket binding not configured/);
    });

    it('Task 19a — renderAndStore always renders through the two-pass TOC path', async () => {
        // generatePdfWithTocPages self-short-circuits to a single pass when the
        // report has no intra-doc anchors, so the service calls it unconditionally
        // and never calls generatePdfFromUrl directly.
        await svc.renderAndStore(INSP_1, TENANT_A, 'full', {
            reportUrl: 'https://example.com/report/insp-1',
            sourceVersion: 1,
        });
        expect(generatePdfWithTocPages).toHaveBeenCalledWith(mockBrowser, 'https://example.com/report/insp-1', undefined);
        expect(generatePdfFromUrl).not.toHaveBeenCalled();
    });

    it('markQueued creates placeholder when no record exists', async () => {
        await svc.markQueued(INSP_1, TENANT_A, 'full');
        const row = await svc.getPdfRecord(INSP_1, TENANT_A, 'full');
        expect(row?.status).toBe('queued');
    });

    it('markQueued updates status when record exists', async () => {
        await svc.renderAndStore(INSP_1, TENANT_A, 'full', { reportUrl: 'u', sourceVersion: 1 });
        await svc.markQueued(INSP_1, TENANT_A, 'full');
        const row = await svc.getPdfRecord(INSP_1, TENANT_A, 'full');
        expect(row?.status).toBe('queued');
        // r2Key preserved across requeue (existing PDF still serveable)
        expect(row?.r2Key).toBe(`${TENANT_A}/${INSP_1}/reports/full.pdf`);
    });

    it('streamPdf returns R2 object body for ready PDF', async () => {
        const fakeBody = { body: 'STREAM' } as unknown as R2ObjectBody;
        const r2WithGet = {
            put: vi.fn(async () => undefined),
            get: vi.fn(async () => fakeBody),
        } as unknown as R2Bucket;
        const s = new ReportPdfService({} as D1Database, mockBrowser, r2WithGet);
        const rec = await s.renderAndStore(INSP_1, TENANT_A, 'full', { reportUrl: 'u', sourceVersion: 1 });
        const obj = await s.streamPdf(rec);
        expect(obj).toBe(fakeBody);
    });

    it('streamPdf throws when record is not ready', async () => {
        await svc.markQueued(INSP_1, TENANT_A, 'full');
        const rec = await svc.getPdfRecord(INSP_1, TENANT_A, 'full');
        await expect(svc.streamPdf(rec!)).rejects.toThrow(/not ready/);
    });

    describe('getOrRender (content-hash cache)', () => {
        const REPORT_URL = 'https://example.com/report/insp-1';
        const HASH_H1 = 'aabbcc1100000000000000000000000000000000000000000000000000000001';
        const HASH_H2 = 'aabbcc2200000000000000000000000000000000000000000000000000000002';

        it('(a) cache HIT — ready row with matching contentHash → returns it, no render', async () => {
            // Seed a ready row with content_hash='H1'.
            await svc.renderAndStore(INSP_1, TENANT_A, 'full', {
                reportUrl: REPORT_URL,
                sourceVersion: 100,
                versionNumber: 1,
                contentHash: HASH_H1,
            });
            vi.clearAllMocks();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (generatePdfWithTocPages as any).mockResolvedValue(new ArrayBuffer(2048));
            (mockR2 as any).put = vi.fn(async () => undefined);

            const rec = await svc.getOrRender(INSP_1, TENANT_A, 'full', {
                reportUrl: REPORT_URL,
                contentHash: HASH_H1,
                versionNumber: 1,
            });

            expect(generatePdfWithTocPages).toHaveBeenCalledTimes(0);
            expect(rec.status).toBe('ready');
            expect(rec.contentHash).toBe(HASH_H1);
        });

        it('(b) cache MISS — different hash → renders once, stores with new contentHash and content-addressed r2Key', async () => {
            // Seed existing ready row with content_hash='H1'.
            await svc.renderAndStore(INSP_1, TENANT_A, 'full', {
                reportUrl: REPORT_URL,
                sourceVersion: 100,
                versionNumber: 1,
                contentHash: HASH_H1,
            });
            vi.clearAllMocks();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (generatePdfWithTocPages as any).mockResolvedValue(new ArrayBuffer(2048));
            (mockR2 as any).put = vi.fn(async () => undefined);

            // Call with different hash H2 → must render.
            const rec = await svc.getOrRender(INSP_1, TENANT_A, 'full', {
                reportUrl: REPORT_URL,
                contentHash: HASH_H2,
                versionNumber: 2,
            });

            expect(generatePdfWithTocPages).toHaveBeenCalledTimes(1);
            expect(rec.status).toBe('ready');
            expect(rec.contentHash).toBe(HASH_H2);
            // Content-addressed R2 key must incorporate the hash.
            expect(rec.r2Key).toContain(HASH_H2);
            expect(rec.r2Key).toMatch(/full-.*\.pdf$/);
        });

        it('(c) cold miss — no row at all → renders once', async () => {
            const rec = await svc.getOrRender(INSP_1, TENANT_A, 'full', {
                reportUrl: REPORT_URL,
                contentHash: HASH_H1,
                versionNumber: null,
            });

            expect(generatePdfWithTocPages).toHaveBeenCalledTimes(1);
            expect(rec.status).toBe('ready');
            expect(rec.contentHash).toBe(HASH_H1);
        });
    });
});
