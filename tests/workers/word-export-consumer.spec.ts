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

function pngBytesFromBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

// Large-report stress fixture — a small set of GENUINELY-DISTINCT valid 1x1
// PNGs (real signature + IHDR so sniffImageDimensions resolves) cycled across
// many appendix photos. docx keys embedded media by a content hash of the
// bytes (ImageRun -> `${hashedId(data)}.<type>`), so N appendix entries drawn
// from these M distinct byte-strings collapse to exactly M image
// relationships in word/_rels/document.xml.rels — even though the consumer
// hands each photo its OWN fresh Uint8Array (dedup is by content, not
// reference). Red / green / blue, opaque 1x1.
const DISTINCT_PNGS_BASE64 = [
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', // red
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaGD4DwAChAGA+gVWHQAAAABJRU5ErkJggg==', // green
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==', // blue
];
const DISTINCT_PNG_COUNT = DISTINCT_PNGS_BASE64.length; // 3

// A GENUINELY-DISTINCT multi-KiB/MiB "photo" blob (real camera originals are all
// distinct, so the docx never dedups them and buildAppendixPhotoInputs must hold
// each full buffer as it accumulates). A PNG signature keeps it image-shaped; the
// body is a single byte that varies by index so every blob is a distinct
// content-hash (fast native fill). Used to exercise the no-IMAGES memory budget
// with realistic-size originals instead of the 68-byte 1x1 PNGs.
function distinctLargeBytes(index: number, byteSize: number): Uint8Array {
    const buf = new Uint8Array(byteSize);
    buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // PNG signature
    buf.fill((index & 0xff), 8);
    return buf;
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

// Seed a full_pca commercial inspection with `photoCount` rich findings, each
// carrying ONE photo with a distinct R2 key, so getReportData's Phase P photo
// numbering yields a gap-free 1..photoCount appendix. The photo BYTES cycle a
// tiny set of distinct PNGs (so the .docx dedupes to DISTINCT_PNG_COUNT image
// relationships) while every KEY stays unique (so all photoCount get numbered).
async function seedLargeCommercialInspection(
    photoCount: number,
    photoBytes: (i: number) => Uint8Array = (i) => pngBytesFromBase64(DISTINCT_PNGS_BASE64[i % DISTINCT_PNG_COUNT]),
): Promise<void> {
    const db = drizzle(b.DB);
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme PCA', slug: `acme-pca-${TENANT.slice(-4)}`, status: 'active',
        deploymentMode: 'shared', tier: 'free', maxUsers: 5, createdAt: new Date(),
    });
    const items = Array.from({ length: photoCount }, (_, i) => ({
        id: `finding-${i + 1}`, label: `Finding ${i + 1}`, type: 'rich',
    }));
    await db.insert(schema.templates).values({
        id: TEMPLATE, tenantId: TENANT, name: 'Commercial PCA', version: 1,
        propertyType: 'commercial',
        schema: JSON.stringify({
            sections: [{ id: 'observations', title: 'Field Observations', items }],
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
    const data: Record<string, unknown> = {};
    for (let i = 0; i < photoCount; i++) {
        const key = `${TENANT}/inspections/${INSPECTION}/photos/photo-${i + 1}.png`;
        data[`finding-${i + 1}`] = {
            rating: 'Satisfactory',
            notes: `Observation ${i + 1}: membrane and flashing inspected; condition documented in photo.`,
            photos: [{ key }],
        };
        await b.PHOTOS.put(key, photoBytes(i));
    }
    await db.insert(schema.inspectionResults).values({
        id: crypto.randomUUID(), tenantId: TENANT, inspectionId: INSPECTION,
        data: JSON.stringify(data),
        lastSyncedAt: new Date(),
    });
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

    // Commercial PCA deferred verification — the .docx export fetches +
    // downscales appendix photos SEQUENTIALLY (buildAppendixPhotoInputs) to
    // bound isolate memory over a large report. This exercises that pipeline at
    // scale: 60 findings -> 60 numbered appendix photos, built to completion in
    // one workerd isolate.
    //
    // What it PROVES: the sequential-fetch pipeline builds a 60-photo full_pca
    // report to completion under the test workerd isolate (no OOM, no timeout)
    // and emits a structurally valid, multi-image .docx (valid zip; Appendix B
    // rendered; all 60 photos numbered; distinct-byte images deduped to real
    // media relationships).
    //
    // What it does NOT prove: it does not profile production isolate memory in
    // MB — vitest-pool-workers limits differ from the prod 128 MB isolate — and
    // it uses tiny synthetic 1x1 PNGs, not multi-MB camera originals, so
    // real-photo memory headroom still needs a deployed measurement.
    it('builds a large 60-photo report without OOM/timeout and emits a valid multi-image .docx', async () => {
        const PHOTO_COUNT = 60;
        await seedLargeCommercialInspection(PHOTO_COUNT);
        const exportService = new ReportExportService(b.DB, b.PHOTOS);
        const { id: exportId } = await exportService.create(TENANT, INSPECTION, 'docx');

        const msg = fakeMessage({ exportId, tenantId: TENANT, inspectionId: INSPECTION, format: 'docx' });
        const batch = { queue: 'openinspection-word-export', messages: [msg] } as unknown as MessageBatch<unknown>;

        await handleWordExportBatch({ DB: b.DB, PHOTOS: b.PHOTOS }, batch);

        // Completed cleanly — one ack, no retry (retry would mean a throw:
        // OOM, timeout, or a build error somewhere in the 60-photo loop).
        expect(msg.ack).toHaveBeenCalledOnce();
        expect(msg.retry).not.toHaveBeenCalled();

        const record = await exportService.get(exportId, TENANT);
        expect(record?.status).toBe('ready');
        expect(record?.r2Key).toBeTruthy();
        expect(record?.sizeBytes).toBeGreaterThan(0);

        const obj = await b.PHOTOS.get(record!.r2Key!);
        expect(obj).not.toBeNull();
        const bytes = new Uint8Array(await obj!.arrayBuffer());
        // Valid .docx == valid zip (PK magic).
        expect(bytes[0]).toBe(0x50);
        expect(bytes[1]).toBe(0x4b);
        expect(bytes.byteLength).toBe(record!.sizeBytes);

        const { unzipSync, strFromU8 } = await import('fflate');
        const files = unzipSync(bytes);

        // Multiple real image relationships — 60 appendix photos drawn from
        // DISTINCT_PNG_COUNT distinct byte-strings collapse to exactly that
        // many media relationships (docx content-hash dedup).
        const rels = strFromU8(files['word/_rels/document.xml.rels']);
        const imageRelCount = (rels.match(/relationships\/image"/g) ?? []).length;
        expect(imageRelCount).toBe(DISTINCT_PNG_COUNT);

        // The appendix rendered and every photo got numbered — the LAST number
        // proves all 60 flowed through Phase P numbering + the render loop.
        const doc = strFromU8(files['word/document.xml']);
        expect(doc).toContain('Appendix B');
        expect(doc).toContain(`PHOTO NO. ${PHOTO_COUNT}`);

        // Surface the scale for the coordinator — workerd tests cannot write
        // host files, so the artifact is generated separately from this line.
        // eslint-disable-next-line no-console
        console.log(`[stress] docx sizeBytes=${record!.sizeBytes} images=${imageRelCount} photoNo max=${PHOTO_COUNT}`);
    }, 60000);

    // Real-isolate memory profile of the dangerous path: env.IMAGES UNSET (an
    // account without Images Transformations), so buildAppendixPhotoInputs embeds
    // full-resolution originals. Without the byte budget a 40 x 1 MiB report would
    // accumulate ~40 MiB of originals + a ~40 MiB docx buffer and OOM a 128 MiB
    // isolate. The APPENDIX_PHOTO_TOTAL_BYTE_BUDGET (32 MiB) must cap embedding so
    // the export always completes — proven here in real workerd with real-size,
    // genuinely-distinct (un-deduped) photo bytes.
    it('caps embedded photo bytes and still completes on a 40 x 1 MiB report with no IMAGES binding', async () => {
        const PHOTO_COUNT = 40;
        const PHOTO_BYTES = 1024 * 1024; // 1 MiB each, distinct → 40 MiB of originals
        await seedLargeCommercialInspection(PHOTO_COUNT, (i) => distinctLargeBytes(i, PHOTO_BYTES));
        const exportService = new ReportExportService(b.DB, b.PHOTOS);
        const { id: exportId } = await exportService.create(TENANT, INSPECTION, 'docx');

        const msg = fakeMessage({ exportId, tenantId: TENANT, inspectionId: INSPECTION, format: 'docx' });
        const batch = { queue: 'openinspection-word-export', messages: [msg] } as unknown as MessageBatch<unknown>;

        // NOTE: no IMAGES binding passed → full-resolution embed path.
        await handleWordExportBatch({ DB: b.DB, PHOTOS: b.PHOTOS }, batch);

        // Completed cleanly — an OOM or throw anywhere in the loop would retry,
        // not ack. This is the "profile passes / no OOM" signal.
        expect(msg.ack).toHaveBeenCalledOnce();
        expect(msg.retry).not.toHaveBeenCalled();
        const record = await exportService.get(exportId, TENANT);
        expect(record?.status).toBe('ready');

        const obj = await b.PHOTOS.get(record!.r2Key!);
        const bytes = new Uint8Array(await obj!.arrayBuffer());
        expect(bytes[0]).toBe(0x50); // PK zip magic
        expect(bytes[1]).toBe(0x4b);

        const { unzipSync, strFromU8 } = await import('fflate');
        const files = unzipSync(bytes);
        const rels = strFromU8(files['word/_rels/document.xml.rels']);
        const imageRelCount = (rels.match(/relationships\/image"/g) ?? []).length;
        const doc = strFromU8(files['word/document.xml']);

        // Budget kicked in: NOT all 40 distinct originals embedded (each is a
        // distinct content-hash → no docx dedup, so imageRelCount == embedded
        // count), and the tail photo (#40) was omitted. ~32 embedded (32 MiB
        // budget / 1 MiB each). >=1 keeps the appendix non-empty.
        expect(imageRelCount).toBeGreaterThan(0);
        expect(imageRelCount).toBeLessThan(PHOTO_COUNT);
        expect(doc).not.toContain(`PHOTO NO. ${PHOTO_COUNT}`);
        // eslint-disable-next-line no-console
        console.log(`[stress] no-IMAGES budget: embedded=${imageRelCount}/${PHOTO_COUNT} docxBytes=${record!.sizeBytes}`);
    }, 60000);

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
