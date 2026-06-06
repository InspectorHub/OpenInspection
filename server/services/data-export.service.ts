import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { inspections, templates, agreements } from '../lib/db/schema';
import { logger } from '../lib/logger';
import { zipSync, Zip, ZipPassThrough, ZipDeflate } from 'fflate';

export interface ExportManifest {
    rows:    number;
    photos:  number;
    /** Number of photos whose bytes were embedded in the ZIP (rest are manifest-only). */
    photosEmbedded: number;
}

export interface DataExportOptions {
    /**
     * Max total photo bytes to embed in the ZIP. Guards against blowing the
     * Worker memory limit on very large tenants — photos beyond the budget stay
     * listed in photos-manifest.json with `included: false`. Default 64 MB
     * (comfortably under the 128 MB Worker isolate limit, leaving headroom for
     * fflate's working buffers and the rest of the archive).
     */
    photoBytesBudget?: number;
}

interface PhotoEntry {
    key:      string;
    size:     number;
    included: boolean;
}

const DEFAULT_PHOTO_BYTES_BUDGET = 64 * 1024 * 1024;

export class DataExportService {
    private readonly photoBytesBudget: number;

    constructor(private db: D1Database, private r2: R2Bucket, opts: DataExportOptions = {}) {
        this.photoBytesBudget = opts.photoBytesBudget ?? DEFAULT_PHOTO_BYTES_BUDGET;
    }

    async buildZip(tenantId: string): Promise<{ buffer: Uint8Array; manifest: ExportManifest }> {
        const d = drizzle(this.db);
        const insps = await d.select().from(inspections).where(eq(inspections.tenantId, tenantId)).all();
        const tpls  = await d.select().from(templates).where(eq(templates.tenantId, tenantId)).all();
        const agrs  = await d.select().from(agreements).where(eq(agreements.tenantId, tenantId)).all();

        // 1. Enumerate every photo object for the tenant.
        const photos: PhotoEntry[] = [];
        let cursor: string | undefined;
        do {
            const list = await this.r2.list({ prefix: `tenants/${tenantId}/`, limit: 1000, ...(cursor ? { cursor } : {}) });
            list.objects.forEach(o => photos.push({ key: o.key, size: o.size, included: false }));
            cursor = list.truncated ? list.cursor : undefined;
        } while (cursor);

        // 2. Stream photo BYTES into the ZIP under a byte budget (Privacy P3 §3.2 —
        //    the post-purge ZIP is the only surviving copy, so a keys-only manifest
        //    is not a full export). Objects beyond the budget remain manifest-only
        //    so a large tenant never blows the Worker memory limit.
        const files: Record<string, Uint8Array> = {};
        let photoBytes = 0;
        for (const p of photos) {
            if (photoBytes + p.size > this.photoBytesBudget) {
                // Skip oversized / over-budget object; it stays manifest-only.
                continue;
            }
            try {
                const obj = await this.r2.get(p.key);
                if (!obj) continue;
                const bytes = new Uint8Array(await obj.arrayBuffer());
                files[`photos/${p.key}`] = bytes;
                photoBytes += bytes.byteLength;
                p.included = true;
            } catch (err) {
                logger.error('Photo fetch failed during export', { tenantId, key: p.key }, err instanceof Error ? err : undefined);
            }
        }
        const photosEmbedded = photos.filter(p => p.included).length;

        const enc = new TextEncoder();
        const zipped = zipSync({
            ...files,
            'inspections.csv':       enc.encode(this.rowsToCsv(insps as never)),
            'templates.json':        enc.encode(JSON.stringify(tpls,   null, 2)),
            'agreements.json':       enc.encode(JSON.stringify(agrs,  null, 2)),
            'photos-manifest.json':  enc.encode(JSON.stringify(photos, null, 2)),
            'README.txt':            enc.encode(
                `Tenant ${tenantId} data export. Generated ${new Date().toISOString()}.\n` +
                `${insps.length} inspections, ${tpls.length} templates, ${photos.length} photos ` +
                `(${photosEmbedded} with embedded bytes under photos/, the rest listed in ` +
                `photos-manifest.json with included=false).\n`
            ),
        });
        const manifest: ExportManifest = { rows: insps.length, photos: photos.length, photosEmbedded };
        logger.info('Data export built', { tenantId, ...manifest, photoBytes });
        return { buffer: zipped, manifest };
    }

    /**
     * A-21 batch 3 — stream the export ZIP straight into the shared
     * EXPORTS_BUCKET via R2 multipart upload. Replaces the in-memory build for
     * the queue path: memory is bounded by ONE part buffer (~8 MiB) + the
     * in-flight read chunk, so the 64 MB photo budget is gone — EVERY photo is
     * embedded. Photos ride ZipPassThrough (already-compressed JPEGs — no
     * recompression); text entries ride ZipDeflate.
     *
     * R2 multipart contract: all parts except the LAST must be the SAME size —
     * the part buffer cuts exact PART_SIZE slices and only the final flush may
     * be smaller. On any failure the upload is aborted (no orphan parts).
     *
     * Idempotent per r2Key: the portal workflow allocates the key once (stable
     * across retries), so a re-sent command simply overwrites the same object.
     */
    async buildZipToR2(
        tenantId: string,
        exportsBucket: R2Bucket,
        r2Key: string,
        opts: { /** Floor-clamped to R2's 5 MiB minimum part size. */ partSizeBytes?: number } = {},
    ): Promise<ExportManifest> {
        const d = drizzle(this.db);
        const insps = await d.select().from(inspections).where(eq(inspections.tenantId, tenantId)).all();
        const tpls  = await d.select().from(templates).where(eq(templates.tenantId, tenantId)).all();
        const agrs  = await d.select().from(agreements).where(eq(agreements.tenantId, tenantId)).all();

        const photos: PhotoEntry[] = [];
        let cursor: string | undefined;
        do {
            const list = await this.r2.list({ prefix: `tenants/${tenantId}/`, limit: 1000, ...(cursor ? { cursor } : {}) });
            list.objects.forEach(o => photos.push({ key: o.key, size: o.size, included: false }));
            cursor = list.truncated ? list.cursor : undefined;
        } while (cursor);

        // R2 contract: every part except the LAST must be the same size, and
        // non-last parts must be ≥5 MiB — the floor clamp keeps callers honest.
        const PART_SIZE = Math.max(opts.partSizeBytes ?? 8 * 1024 * 1024, 5 * 1024 * 1024);
        const upload = await exportsBucket.createMultipartUpload(r2Key);
        const parts: R2UploadedPart[] = [];
        let partNumber = 1;
        const pending: Uint8Array[] = [];
        let pendingBytes = 0;
        let zipErr: Error | null = null;

        // fflate's Zip delivers output chunks synchronously during push()/end().
        const zip = new Zip((err, chunk) => {
            if (err) { zipErr = err instanceof Error ? err : new Error(String(err)); return; }
            if (chunk && chunk.length > 0) { pending.push(chunk); pendingBytes += chunk.length; }
        });

        /** Concatenate exactly `n` bytes off the pending list (remainder kept). */
        const takeExact = (n: number): Uint8Array => {
            const out = new Uint8Array(n);
            let filled = 0;
            while (filled < n) {
                const head = pending[0]!;
                const need = n - filled;
                if (head.length <= need) {
                    out.set(head, filled);
                    filled += head.length;
                    pending.shift();
                } else {
                    out.set(head.subarray(0, need), filled);
                    pending[0] = head.subarray(need);
                    filled = n;
                }
            }
            pendingBytes -= n;
            return out;
        };

        const flushFullParts = async (): Promise<void> => {
            if (zipErr) throw zipErr;
            while (pendingBytes >= PART_SIZE) {
                parts.push(await upload.uploadPart(partNumber++, takeExact(PART_SIZE)));
            }
        };

        try {
            // 1. Photos — stream each R2 object through a pass-through entry.
            for (const p of photos) {
                let obj: R2ObjectBody | null = null;
                try {
                    obj = await this.r2.get(p.key);
                } catch (err) {
                    logger.error('Photo fetch failed during export', { tenantId, key: p.key }, err instanceof Error ? err : undefined);
                }
                if (!obj) continue;
                const entry = new ZipPassThrough(`photos/${p.key}`);
                zip.add(entry);
                const reader = obj.body.getReader();
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    entry.push(value);
                    await flushFullParts();
                }
                entry.push(new Uint8Array(0), true);
                p.included = true;
                await flushFullParts();
            }
            const photosEmbedded = photos.filter(p => p.included).length;

            // 2. Text entries (deflated).
            const enc = new TextEncoder();
            const addText = (name: string, content: string): void => {
                const entry = new ZipDeflate(name);
                zip.add(entry);
                entry.push(enc.encode(content), true);
            };
            addText('inspections.csv', this.rowsToCsv(insps as never));
            addText('templates.json', JSON.stringify(tpls, null, 2));
            addText('agreements.json', JSON.stringify(agrs, null, 2));
            addText('photos-manifest.json', JSON.stringify(photos, null, 2));
            addText('README.txt',
                `Tenant ${tenantId} data export. Generated ${new Date().toISOString()}.\n` +
                `${insps.length} inspections, ${tpls.length} templates, ${photos.length} photos ` +
                `(${photosEmbedded} with embedded bytes under photos/; any photo missing from ` +
                `photos/ failed to read and is listed in photos-manifest.json with included=false).\n`);
            zip.end();
            await flushFullParts();

            // 3. Final (possibly short) part + complete.
            if (pendingBytes > 0) {
                parts.push(await upload.uploadPart(partNumber++, takeExact(pendingBytes)));
            }
            if (zipErr) throw zipErr;
            await upload.complete(parts);

            const manifest: ExportManifest = { rows: insps.length, photos: photos.length, photosEmbedded };
            logger.info('Data export streamed to R2', { tenantId, r2Key, parts: parts.length, ...manifest });
            return manifest;
        } catch (err) {
            await upload.abort().catch(() => { /* already gone */ });
            throw err;
        }
    }

    private rowsToCsv(rows: Record<string, unknown>[]): string {
        if (!rows.length) return '';
        const cols = Object.keys(rows[0]!);
        const escape = (v: unknown) => {
            const s = v == null ? '' : String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        return [cols.join(','), ...rows.map(r => cols.map(c => escape(r[c])).join(','))].join('\n');
    }
}
