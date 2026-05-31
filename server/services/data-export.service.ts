import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { inspections, templates, agreements } from '../lib/db/schema';
import { logger } from '../lib/logger';
import { zipSync } from 'fflate';

export interface ExportManifest {
    rows:    number;
    photos:  number;
}

export class DataExportService {
    constructor(private db: D1Database, private r2: R2Bucket) {}

    async buildZip(tenantId: string): Promise<{ buffer: Uint8Array; manifest: ExportManifest }> {
        const d = drizzle(this.db);
        const insps = await d.select().from(inspections).where(eq(inspections.tenantId, tenantId)).all();
        const tpls  = await d.select().from(templates).where(eq(templates.tenantId, tenantId)).all();
        const agrs  = await d.select().from(agreements).where(eq(agreements.tenantId, tenantId)).all();

        const photos: { key: string; size: number }[] = [];
        let cursor: string | undefined;
        do {
            const list = await this.r2.list({ prefix: `tenants/${tenantId}/`, limit: 1000, ...(cursor ? { cursor } : {}) });
            list.objects.forEach(o => photos.push({ key: o.key, size: o.size }));
            cursor = list.truncated ? list.cursor : undefined;
        } while (cursor);

        const zipped = zipSync({
            'inspections.csv':       new TextEncoder().encode(this.rowsToCsv(insps as never)),
            'templates.json':        new TextEncoder().encode(JSON.stringify(tpls,   null, 2)),
            'agreements.json':       new TextEncoder().encode(JSON.stringify(agrs,  null, 2)),
            'photos-manifest.json':  new TextEncoder().encode(JSON.stringify(photos, null, 2)),
            'README.txt':            new TextEncoder().encode(
                `Tenant ${tenantId} data export. Generated ${new Date().toISOString()}.\n` +
                `${insps.length} inspections, ${tpls.length} templates, ${photos.length} photos.\n`
            ),
        });
        const manifest: ExportManifest = { rows: insps.length, photos: photos.length };
        logger.info('Data export built', { tenantId, ...manifest });
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
