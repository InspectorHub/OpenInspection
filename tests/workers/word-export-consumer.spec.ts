// Commercial PCA Phase W Task 5 — the queue consumer under real workerd.
// Schema is seeded by replaying the real migration .sql files (same pattern
// as report-amendments.spec.ts) so the full getReportData read path (dozens
// of tables) is exercised against the actual production schema rather than
// hand-maintained DDL.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../../server/lib/db/schema';
import { handleWordExportBatch } from '../../server/services/report-export-consumer';
import { ReportExportService } from '../../server/services/report-export.service';
import type { WordExportJob } from '../../server/lib/sync-events/word-export-job';

const b = env as unknown as { DB: D1Database; PHOTOS: R2Bucket };

const TENANT = '00000000-0000-0000-0000-0000000000w1';
const INSPECTION = '11111111-1111-1111-1111-1111111111w1';
const TEMPLATE = '22222222-2222-2222-2222-2222222222w1';
const PHOTO_KEY = `${TENANT}/inspections/${INSPECTION}/photos/roof-1.png`;

// A minimal valid 1x1 transparent PNG — real PNG signature + IHDR so
// sniffImageDimensions resolves real (1, 1) dimensions.
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
function tinyPngBytes(): Uint8Array {
    const bin = atob(TINY_PNG_BASE64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

// Replay every migration .sql exactly as production applies them (mirrors
// tests/workers/report-amendments.spec.ts).
const migrationSql = import.meta.glob('../../migrations/*.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

async function applyMigrations(): Promise<void> {
    const files = Object.keys(migrationSql).sort();
    for (const file of files) {
        const sql = migrationSql[file]!;
        for (const stmt of sql.split('--> statement-breakpoint')) {
            const cleaned = stmt
                .split('\n')
                .filter((line) => !line.trim().startsWith('--'))
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (cleaned) await b.DB.exec(cleaned);
        }
    }
}

async function seedCommercialInspection(): Promise<void> {
    const db = drizzle(b.DB);
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme PCA', slug: `acme-pca-${TENANT.slice(-4)}`, status: 'active',
        deploymentMode: 'shared', tier: 'free', maxUsers: 5, createdAt: new Date(),
    });
    await db.insert(schema.templates).values({
        id: TEMPLATE, tenantId: TENANT, name: 'Commercial PCA', version: 1,
        propertyType: 'commercial',
        schema: JSON.stringify({
            sections: [{
                id: 'roofing', title: 'Roofing',
                items: [{ id: 'roof-covering', label: 'Roof Covering', type: 'rich' }],
            }],
        }),
        createdAt: new Date(),
    });
    await db.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT, templateId: TEMPLATE,
        propertyAddress: '500 Commerce Way', date: '2026-07-01',
        status: 'requested', reportStatus: 'in_progress', paymentStatus: 'unpaid', price: 0,
        paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        propertyType: 'commercial', reportTier: 'full_pca', sqft: 10000,
    });
    await db.insert(schema.inspectionResults).values({
        id: crypto.randomUUID(), tenantId: TENANT, inspectionId: INSPECTION,
        data: JSON.stringify({
            'roof-covering': {
                rating: 'Satisfactory',
                notes: 'Membrane shows granule loss near the east parapet.',
                photos: [{ key: PHOTO_KEY }],
            },
        }),
        lastSyncedAt: new Date(),
    });
    await db.insert(schema.costItems).values({
        id: crypto.randomUUID(), tenantId: TENANT, inspectionId: INSPECTION,
        system: 'Roofing', component: 'Membrane replacement', location: '',
        action: 'replace', costMethod: 'lump_sum', lumpSumCents: 500_000,
        suggestedRemedy: 'Replace membrane within 12 months.',
        bucket: 'immediate', sortOrder: 0,
    });
    await b.PHOTOS.put(PHOTO_KEY, tinyPngBytes());
}

async function clearAll(): Promise<void> {
    for (const t of [
        'report_exports', 'cost_items', 'inspection_results', 'inspections', 'templates', 'tenants',
    ]) {
        await b.DB.exec(`DELETE FROM ${t};`);
    }
}

function fakeMessage(body: WordExportJob) {
    return {
        id: crypto.randomUUID(),
        timestamp: new Date(),
        body,
        attempts: 1,
        ack: vi.fn(),
        retry: vi.fn(),
    };
}

describe('Word export consumer — real workerd (Commercial PCA Phase W Task 5)', () => {
    beforeAll(applyMigrations);
    beforeEach(clearAll);

    it('builds the .docx, writes it to R2, and flips the status row to ready', async () => {
        await seedCommercialInspection();
        const exportService = new ReportExportService(b.DB, b.PHOTOS);
        const { id: exportId } = await exportService.create(TENANT, INSPECTION, 'docx');

        const msg = fakeMessage({ exportId, tenantId: TENANT, inspectionId: INSPECTION, format: 'docx' });
        const batch = { queue: 'openinspection-word-export', messages: [msg] } as unknown as MessageBatch<unknown>;

        await handleWordExportBatch({ DB: b.DB, PHOTOS: b.PHOTOS }, batch);

        expect(msg.ack).toHaveBeenCalledOnce();
        expect(msg.retry).not.toHaveBeenCalled();

        const record = await exportService.get(exportId, TENANT);
        expect(record?.status).toBe('ready');
        expect(record?.r2Key).toBeTruthy();
        expect(record?.sizeBytes).toBeGreaterThan(0);

        const obj = await b.PHOTOS.get(record!.r2Key!);
        expect(obj).not.toBeNull();
        const bytes = new Uint8Array(await obj!.arrayBuffer());
        // PK zip magic — a valid .docx is a zip.
        expect(bytes[0]).toBe(0x50);
        expect(bytes[1]).toBe(0x4b);
        expect(bytes.byteLength).toBe(record!.sizeBytes);
    });

    it('failure path: bad inspectionId marks the row failed and retries the message', async () => {
        await seedCommercialInspection();
        const exportService = new ReportExportService(b.DB, b.PHOTOS);
        const { id: exportId } = await exportService.create(TENANT, INSPECTION, 'docx');

        const msg = fakeMessage({ exportId, tenantId: TENANT, inspectionId: 'ghost-inspection', format: 'docx' });
        const batch = { queue: 'openinspection-word-export', messages: [msg] } as unknown as MessageBatch<unknown>;

        await handleWordExportBatch({ DB: b.DB, PHOTOS: b.PHOTOS }, batch);

        expect(msg.ack).not.toHaveBeenCalled();
        expect(msg.retry).toHaveBeenCalledOnce();

        const record = await exportService.get(exportId, TENANT);
        expect(record?.status).toBe('failed');
        expect(record?.error).toBeTruthy();
    });
});
