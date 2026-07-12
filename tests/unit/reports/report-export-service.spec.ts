// tests/unit/reports/report-export-service.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReportExportService } from '../../../server/services/report-export.service';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

// Same harness pattern as pca-compliance-service.spec.ts / report-version-service.spec.ts:
// ReportExportService calls `drizzle(this.db)` internally, so mocking
// `drizzle-orm/d1`'s `drizzle` to return the in-memory better-sqlite3 db lets
// the service share the same test database as the seed helpers below.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

function fakeR2(objects: Map<string, { body: Uint8Array }>): R2Bucket {
    return {
        put: vi.fn(async (key: string, value: Uint8Array) => {
            objects.set(key, { body: value });
        }),
        get: vi.fn(async (key: string) => {
            const obj = objects.get(key);
            if (!obj) return null;
            return {
                body: obj.body,
                arrayBuffer: async () => obj.body.buffer,
            };
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

describe('ReportExportService (Commercial PCA Phase W Task 4)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let r2Objects: Map<string, { body: Uint8Array }>;
    let svc: ReportExportService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        r2Objects = new Map();
        svc = new ReportExportService({} as D1Database, fakeR2(r2Objects));
    });

    it('create() inserts a queued row', async () => {
        const { id } = await svc.create('t1', 'insp1', 'docx');
        expect(id).toBeTruthy();
        const row = await svc.get(id, 't1');
        expect(row?.status).toBe('queued');
        expect(row?.tenantId).toBe('t1');
        expect(row?.inspectionId).toBe('insp1');
        expect(row?.format).toBe('docx');
        expect(row?.r2Key).toBeNull();
    });

    it('markBuilding() flips status to building', async () => {
        const { id } = await svc.create('t1', 'insp1', 'docx');
        await svc.markBuilding(id, 't1');
        const row = await svc.get(id, 't1');
        expect(row?.status).toBe('building');
    });

    it('markReady() flips to ready with r2Key + sizeBytes', async () => {
        const { id } = await svc.create('t1', 'insp1', 'docx');
        await svc.markBuilding(id, 't1');
        await svc.markReady(id, 't1', 't1/inspections/insp1/exports/x.docx', 12345);
        const row = await svc.get(id, 't1');
        expect(row?.status).toBe('ready');
        expect(row?.r2Key).toBe('t1/inspections/insp1/exports/x.docx');
        expect(row?.sizeBytes).toBe(12345);
        expect(row?.error).toBeNull();
    });

    it('markFailed() flips to failed with an error message', async () => {
        const { id } = await svc.create('t1', 'insp1', 'docx');
        await svc.markFailed(id, 't1', 'boom');
        const row = await svc.get(id, 't1');
        expect(row?.status).toBe('failed');
        expect(row?.error).toBe('boom');
    });

    it('get() is tenant-scoped — a different tenant sees null', async () => {
        const { id } = await svc.create('t1', 'insp1', 'docx');
        const row = await svc.get(id, 't2');
        expect(row).toBeNull();
    });

    it('stream() returns the R2 object body when status is ready', async () => {
        const { id } = await svc.create('t1', 'insp1', 'docx');
        const key = 't1/inspections/insp1/exports/y.docx';
        r2Objects.set(key, { body: new Uint8Array([0x50, 0x4b, 1, 2]) });
        await svc.markReady(id, 't1', key, 4);
        const row = await svc.get(id, 't1');
        const obj = await svc.stream(row!);
        expect(obj).not.toBeNull();
        const bytes = new Uint8Array(await obj!.arrayBuffer());
        expect(bytes[0]).toBe(0x50);
        expect(bytes[1]).toBe(0x4b);
    });

    it('stream() throws when the record is not ready', async () => {
        const { id } = await svc.create('t1', 'insp1', 'docx');
        const row = await svc.get(id, 't1');
        await expect(svc.stream(row!)).rejects.toThrow();
    });
});
