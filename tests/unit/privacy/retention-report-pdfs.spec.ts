/**
 * The report-PDF sweep — the first retention rule that reaches outside D1.
 *
 * Every other executor is a `db.delete(...)`. This row POINTS AT an R2 object,
 * so deleting the row while the object survives is not a partial success: it is
 * strictly worse than doing nothing, because the object is then unreachable by
 * anything that could ever delete it — the row was the only thing that knew its
 * key. That is why a missing bucket is a REFUSAL and not a degraded mode.
 *
 * It is also the first rule whose window is per-tenant. The manifest carries
 * the platform default; the tenant's own choice overrides it, and zero means
 * indefinite — an instruction the platform executes, so a thirty-year-old PDF
 * belonging to a tenant who chose 0 must survive a sweep that is otherwise
 * working correctly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import { asAnyDb } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { reportPdfs, tenantConfigs, tenants, parkedCmdEvents } from '../../../server/lib/db/schema';
import { runLogRetentionSweep, RetentionSweepError } from '../../../server/lib/compliance/retention-logs';
import { REPORT_PDF_RETENTION_DEFAULT_YEARS } from '../../../server/lib/compliance/report-pdf-retention';

const TENANT = '00000000-0000-0000-0000-0000000000a1';
const OTHER = '00000000-0000-0000-0000-0000000000a2';
const NOW = Date.UTC(2026, 7, 17);
const yearsAgo = (n: number) => NOW - n * 365.25 * 24 * 60 * 60 * 1000;

/** An R2 stub that actually holds objects — a no-op would make every deletion assertion vacuous. */
function makeR2(seed: string[] = []) {
    const store = new Set(seed);
    return {
        store,
        bucket: {
            delete: async (keys: string | string[]) => {
                for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
            },
            get: async (k: string) => (store.has(k) ? ({} as R2ObjectBody) : null),
        } as unknown as R2Bucket,
    };
}

describe('report_pdfs retention', () => {
    let db: BetterSQLite3Database<typeof schema>;

    async function seedPdf(id: string, tenantId: string, agedYears: number, r2Key: string) {
        await db.insert(reportPdfs).values({
            id, tenantId, inspectionId: `i-${id}`, type: 'full', r2Key,
            renderedAt: new Date(yearsAgo(agedYears)), sourceVersion: 1, status: 'ready',
        });
    }

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        for (const id of [TENANT, OTHER]) {
            await db.insert(tenants).values({
                id, slug: `t-${id.slice(-2)}`, status: 'active',
                deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
            });
        }
    });

    it('deletes the R2 object and the row together', async () => {
        const key = `${TENANT}/i-p1/reports/full-abc.pdf`;
        await seedPdf('p1', TENANT, REPORT_PDF_RETENTION_DEFAULT_YEARS + 1, key);
        const r2 = makeR2([key]);

        const out = await runLogRetentionSweep(asAnyDb(db), NOW, { photos: r2.bucket });

        expect(out.perTable['report_pdfs']).toBe(1);
        expect(r2.store.has(key)).toBe(false);
        expect(await db.select().from(reportPdfs).all()).toHaveLength(0);
    });

    it('refuses to delete the row when no bucket was supplied, rather than orphaning the object', async () => {
        await seedPdf('p1', TENANT, REPORT_PDF_RETENTION_DEFAULT_YEARS + 1, 'k');

        await expect(runLogRetentionSweep(asAnyDb(db), NOW, {}))
            .rejects.toThrow(/report_pdfs.*bucket/i);

        // The row is the only thing that knows the object's key. Deleting it
        // without the object makes the object unreachable forever.
        expect(await db.select().from(reportPdfs).all()).toHaveLength(1);
    });

    it('keeps a row that is inside the window', async () => {
        const key = 'inside';
        await seedPdf('p1', TENANT, REPORT_PDF_RETENTION_DEFAULT_YEARS - 1, key);
        const r2 = makeR2([key]);

        const out = await runLogRetentionSweep(asAnyDb(db), NOW, { photos: r2.bucket });

        expect(out.perTable['report_pdfs']).toBe(0);
        expect(r2.store.has(key)).toBe(true);
        expect(await db.select().from(reportPdfs).all()).toHaveLength(1);
    });

    it('respects a tenant that chose indefinite', async () => {
        await db.insert(tenantConfigs).values({ tenantId: TENANT, reportPdfRetentionYears: 0, updatedAt: new Date() });
        const key = 'ancient';
        await seedPdf('p1', TENANT, 30, key);
        const r2 = makeR2([key]);

        const out = await runLogRetentionSweep(asAnyDb(db), NOW, { photos: r2.bucket });

        expect(out.perTable['report_pdfs'] ?? 0).toBe(0);
        expect(r2.store.has(key)).toBe(true);
    });

    it('respects a tenant that chose SHORTER than the default', async () => {
        // The direction the platform default would hide: a three-year tenant's
        // five-year-old PDF must go, and a sweep using only the default keeps it.
        await db.insert(tenantConfigs).values({ tenantId: TENANT, reportPdfRetentionYears: 3, updatedAt: new Date() });
        const key = 'five-years';
        await seedPdf('p1', TENANT, 5, key);
        const r2 = makeR2([key]);

        const out = await runLogRetentionSweep(asAnyDb(db), NOW, { photos: r2.bucket });

        expect(out.perTable['report_pdfs']).toBe(1);
        expect(r2.store.has(key)).toBe(false);
    });

    it('applies each tenant\'s own window in the same sweep', async () => {
        // One pass, two tenants, two answers. A sweep that read one config and
        // applied it to every row would pass all the tests above.
        await db.insert(tenantConfigs).values([
            { tenantId: TENANT, reportPdfRetentionYears: 0, updatedAt: new Date() },   // indefinite
            { tenantId: OTHER, reportPdfRetentionYears: 3, updatedAt: new Date() },
        ]);
        await seedPdf('p-keep', TENANT, 20, 'keep');
        await seedPdf('p-go', OTHER, 5, 'go');
        const r2 = makeR2(['keep', 'go']);

        const out = await runLogRetentionSweep(asAnyDb(db), NOW, { photos: r2.bucket });

        expect(out.perTable['report_pdfs']).toBe(1);
        expect(r2.store.has('keep')).toBe(true);
        expect(r2.store.has('go')).toBe(false);
        const left = await db.select().from(reportPdfs).all();
        expect(left.map((r) => r.id)).toEqual(['p-keep']);
    });

    it('a tenant with no config row gets the platform default, not indefinite', async () => {
        // The failure this catches is a LEFT JOIN whose null becomes 0, which
        // would silently convert every silent tenant to indefinite retention —
        // the exact opposite of the disclosed default.
        const key = 'no-config';
        await seedPdf('p1', TENANT, REPORT_PDF_RETENTION_DEFAULT_YEARS + 1, key);
        const r2 = makeR2([key]);

        const out = await runLogRetentionSweep(asAnyDb(db), NOW, { photos: r2.bucket });

        expect(out.perTable['report_pdfs']).toBe(1);
        expect(r2.store.has(key)).toBe(false);
    });

    it('a missing bucket does not stop the OTHER fourteen tables from expiring', async () => {
        // The first draft threw on entry, which traded one silent gap for
        // fourteen: a deployment with no PHOTOS binding would have had its whole
        // retention sweep refused. Failures are collected and rethrown after
        // every other rule has run, and the partial summary rides on the error
        // so a caller can still log what did expire.
        await seedPdf('p1', TENANT, REPORT_PDF_RETENTION_DEFAULT_YEARS + 1, 'k');
        await db.insert(parkedCmdEvents).values({
            id: 'parked-old', envelope: 'x', reason: 'unknown-type-or-version',
            receivedAt: new Date(yearsAgo(2)),
        });

        const err = await runLogRetentionSweep(asAnyDb(db), NOW, {}).catch((e: unknown) => e);

        expect(err).toBeInstanceOf(RetentionSweepError);
        const e = err as RetentionSweepError;
        expect(e.failures.join(' ')).toMatch(/report_pdfs/);
        // The dead-letter row expired anyway.
        expect(e.summary.perTable['parked_cmd_events']).toBe(1);
        expect(await db.select().from(parkedCmdEvents).all()).toHaveLength(0);
        // And the PDF row is still there, unharmed.
        expect(await db.select().from(reportPdfs).all()).toHaveLength(1);
    });

    it('a deployment with nothing expired never needs the bucket at all', async () => {
        // Demanding it on entry would refuse a sweep over a binding the run did
        // not need — the refusal fires only when there is something this
        // executor would otherwise half-delete.
        await seedPdf('p1', TENANT, 1, 'young');
        const out = await runLogRetentionSweep(asAnyDb(db), NOW, {});
        expect(out.perTable['report_pdfs']).toBe(0);
    });

    it('a bucket that throws leaves the row, so the object is never orphaned', async () => {
        await seedPdf('p1', TENANT, REPORT_PDF_RETENTION_DEFAULT_YEARS + 1, 'k');
        const throwing = {
            delete: async () => { throw new Error('R2 down'); },
        } as unknown as R2Bucket;

        await expect(runLogRetentionSweep(asAnyDb(db), NOW, { photos: throwing })).rejects.toThrow();
        expect(await db.select().from(reportPdfs).all()).toHaveLength(1);
    });
});
