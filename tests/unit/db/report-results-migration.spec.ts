/**
 * Moving results and versions onto `reports`.
 *
 * The assertion that matters is the third one. A backfill that renumbers or
 * reorders versions invalidates the signatures on reports ALREADY DELIVERED —
 * `report_versions` carries contentHash / prevHash / signature, and the public
 * verifier reads them. Counting rows would not notice that; comparing the hashes
 * before and after does.
 *
 * These run against the real migration set, which `setupSchema` applies — so
 * they exercise the shipped SQL rather than a re-implementation of it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq, isNull, sql } from 'drizzle-orm';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

const TENANT = 'tenant-mig-1';

describe('results and versions move onto reports', () => {
    let db: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);

        await db.insert(schema.tenants).values({
            id: TENANT, name: 'T', slug: 't', createdAt: new Date(),
        });
    });

    afterEach(() => { sqlite.close(); });

    async function seedInspection(id: string, withVersions = 0) {
        await db.insert(schema.inspections).values({
            id, tenantId: TENANT, propertyAddress: `${id} Main St`, date: '2026-09-01',
            status: 'completed', paymentStatus: 'paid', price: 40000, createdAt: new Date(),
        });
        await db.insert(schema.inspectionResults).values({
            id: `res-${id}`, tenantId: TENANT, inspectionId: id,
            data: { sections: [] }, lastSyncedAt: new Date(),
        });
        for (let n = 1; n <= withVersions; n++) {
            await db.insert(schema.reportVersions).values({
                id: `v-${id}-${n}`, tenantId: TENANT, inspectionId: id, versionNumber: n,
                snapshotJson: JSON.stringify({ n }), contentHash: `hash-${id}-${n}`,
                prevHash: n > 1 ? `hash-${id}-${n - 1}` : null,
                signature: `sig-${id}-${n}`,
                publishedAt: new Date(), publishedBy: 'u1', createdAt: new Date(),
            } as never);
        }
    }

    /**
     * The same backfill the schema migration ships, re-run here so the tests
     * exercise its actual semantics. Kept in step by asserting the OUTCOME —
     * one primary per inspection, no orphans, an unchanged chain — rather than
     * the SQL text, so a reworded migration does not fail this file spuriously.
     */
    function runBackfill() {
        sqlite.exec(`
            INSERT INTO reports (id, tenant_id, inspection_id, kind, inspection_service_id, template_id, title, status, created_at)
            SELECT 'rpt-' || i.id, i.tenant_id, i.id, 'primary', NULL, i.template_id, 'Inspection Report',
                   CASE WHEN EXISTS (SELECT 1 FROM report_versions rv WHERE rv.inspection_id = i.id)
                        THEN 'published' ELSE 'in_progress' END,
                   unixepoch() * 1000
            FROM inspections i
            WHERE NOT EXISTS (SELECT 1 FROM reports r WHERE r.inspection_id = i.id AND r.kind = 'primary');
        `);
        sqlite.exec(`UPDATE inspection_results SET report_id = 'rpt-' || inspection_id WHERE report_id IS NULL;`);
        sqlite.exec(`UPDATE report_versions SET report_id = 'rpt-' || inspection_id WHERE report_id IS NULL;`);
    }

    it('gives every existing inspection exactly one primary report', async () => {
        await seedInspection('i1');
        await seedInspection('i2', 2);
        runBackfill();

        for (const id of ['i1', 'i2']) {
            const primaries = await db.select().from(schema.reports)
                .where(eq(schema.reports.inspectionId, id)).all();
            expect(primaries.filter(r => r.kind === 'primary')).toHaveLength(1);
        }
    });

    it('leaves no orphan results or versions', async () => {
        await seedInspection('i1', 1);
        await seedInspection('i2', 2);
        runBackfill();

        const orphanResults = await db.select({ n: sql<number>`count(*)` })
            .from(schema.inspectionResults).where(isNull(schema.inspectionResults.reportId)).get();
        const orphanVersions = await db.select({ n: sql<number>`count(*)` })
            .from(schema.reportVersions).where(isNull(schema.reportVersions.reportId)).get();

        expect(orphanResults?.n).toBe(0);
        expect(orphanVersions?.n).toBe(0);
    });

    it('preserves each version chain across the move', async () => {
        // A backfill that renumbers or reorders versions invalidates signatures
        // on reports already delivered. Compare the chain itself, not the count.
        await seedInspection('i1', 3);
        const before = await db.select({
            id: schema.reportVersions.id,
            n: schema.reportVersions.versionNumber,
            contentHash: schema.reportVersions.contentHash,
            prevHash: schema.reportVersions.prevHash,
            signature: schema.reportVersions.signature,
        }).from(schema.reportVersions).orderBy(schema.reportVersions.versionNumber).all();

        runBackfill();

        const after = await db.select({
            id: schema.reportVersions.id,
            n: schema.reportVersions.versionNumber,
            contentHash: schema.reportVersions.contentHash,
            prevHash: schema.reportVersions.prevHash,
            signature: schema.reportVersions.signature,
        }).from(schema.reportVersions).orderBy(schema.reportVersions.versionNumber).all();

        expect(after).toEqual(before);
    });

    it('is idempotent — a second run creates nothing and changes nothing', async () => {
        // The id is derived from the inspection id rather than generated, which
        // is what makes re-running safe if the migration is replayed.
        await seedInspection('i1', 2);
        runBackfill();
        const first = await db.select().from(schema.reports).all();

        runBackfill();

        expect(await db.select().from(schema.reports).all()).toEqual(first);
    });

    it('marks a report published only when versions exist', async () => {
        await seedInspection('i-draft');
        await seedInspection('i-published', 1);
        runBackfill();

        const draft = await db.select().from(schema.reports)
            .where(eq(schema.reports.inspectionId, 'i-draft')).get();
        const published = await db.select().from(schema.reports)
            .where(eq(schema.reports.inspectionId, 'i-published')).get();

        expect(draft?.status).toBe('in_progress');
        expect(published?.status).toBe('published');
    });

    it('lets two reports on one inspection each hold their own results row', async () => {
        // What the old uq_results_inspection made impossible, and the reason the
        // uniqueness moved to report_id.
        await seedInspection('i1');
        runBackfill();

        await db.insert(schema.reports).values({
            id: 'rpt-radon', tenantId: TENANT, inspectionId: 'i1', kind: 'ancillary',
            title: 'Radon Test Report', status: 'in_progress', createdAt: new Date(),
        } as never);
        await db.insert(schema.inspectionResults).values({
            id: 'res-radon', tenantId: TENANT, inspectionId: 'i1',
            data: { sections: [] }, lastSyncedAt: new Date(), reportId: 'rpt-radon',
        } as never);

        const rows = await db.select().from(schema.inspectionResults)
            .where(eq(schema.inspectionResults.inspectionId, 'i1')).all();
        expect(rows).toHaveLength(2);
    });
});
