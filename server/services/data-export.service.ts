import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { inspections, templates, agreements } from '../lib/db/schema';
import { logger } from '../lib/logger';
import { zipSync } from 'fflate';

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
