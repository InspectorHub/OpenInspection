/**
 * deleteInspectionCascade — hard-delete an inspection and every row + R2 asset
 * it owns. D1 does not enforce FK cascades at runtime, so a bare inspection
 * delete orphans children (incl. still-resolvable access tokens) and leaks R2.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { deleteInspectionCascade } from '../../../server/services/inspection/inspection-cascade';
import { inspectionScopedTables } from '../../../server/lib/db/scoped-tables';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP = 'i-1';

function makeR2(objects: { key: string; size: number }[]) {
    const deleted: string[] = [];
    return {
        bucket: {
            list: async (opts?: { prefix?: string }) => ({
                objects: opts?.prefix ? objects.filter(o => o.key.startsWith(opts.prefix!)) : objects,
                truncated: false,
                cursor: undefined,
            }),
            delete: async (keys: string[] | string) => { deleted.push(...(Array.isArray(keys) ? keys : [keys])); },
        } as unknown as R2Bucket,
        deleted,
    };
}

describe('deleteInspectionCascade', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(fix.sqlite);
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 St', date: '2026-06-01',
            status: 'requested', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
    });

    it('deletes the inspection, its child rows, and its R2 assets', async () => {
        // Seed representative children that a bare delete used to orphan.
        await testDb.insert(schema.inspectionResults).values({
            id: 'res-1', tenantId: TENANT, inspectionId: INSP, data: '{}',
            lastSyncedAt: new Date(), createdAt: new Date(),
        } as never);
        await testDb.insert(schema.invoices).values({
            id: 'inv-1', tenantId: TENANT, inspectionId: INSP, amountCents: 5000,
            lineItems: [{ description: 'x', amountCents: 5000 }], createdAt: new Date(),
        } as never);
        await testDb.insert(schema.inspectionAccessTokens).values({
            id: 'tok-1', tenantId: TENANT, inspectionId: INSP, recipientEmail: 'jane@test.com',
            role: 'client', createdAt: new Date(),
        } as never);
        await testDb.insert(schema.inspectionMessages).values({
            id: 'msg-1', tenantId: TENANT, inspectionId: INSP, contactId: 'c-cascade', fromRole: 'client',
            body: 'hi', createdAt: new Date(),
        } as never);

        const photoKey = `${TENANT}/inspections/${INSP}/photos/m-1.jpg`;
        const otherInspKey = `${TENANT}/inspections/i-2/photos/m-9.jpg`;
        const r2 = makeR2([{ key: photoKey, size: 100 }, { key: otherInspKey, size: 100 }]);

        await deleteInspectionCascade(testDb as unknown as DrizzleD1Database, r2.bucket, TENANT, INSP);

        expect(await testDb.select().from(schema.inspections).all()).toHaveLength(0);
        expect(await testDb.select().from(schema.inspectionResults).all()).toHaveLength(0);
        expect(await testDb.select().from(schema.invoices).all()).toHaveLength(0);
        expect(await testDb.select().from(schema.inspectionAccessTokens).all()).toHaveLength(0);
        expect(await testDb.select().from(schema.inspectionMessages).all()).toHaveLength(0);
        // R2: only THIS inspection's prefix is swept; a sibling inspection survives.
        expect(r2.deleted).toContain(photoKey);
        expect(r2.deleted).not.toContain(otherInspKey);
    });

    it('the derived inspection-scoped set covers child tables but not `inspections` itself', () => {
        const names = new Set(inspectionScopedTables().map(getTableName));
        for (const t of ['inspection_results', 'invoices', 'inspection_access_tokens', 'inspection_messages']) {
            expect(names.has(t), `cascade must cover ${t}`).toBe(true);
        }
        expect(names.has('inspections')).toBe(false);
    });

    it('keeps the offline import record: it is what stops a repeat import from reviving a deleted inspection', () => {
        const names = new Set(inspectionScopedTables().map(getTableName));
        expect(names.has('offline_import_applied')).toBe(false);
        expect(names.has('inspection_results')).toBe(true);
    });

    it('keeps the tombstone out of the derived set, or the cascade would delete the row it just wrote', () => {
        const names = new Set(inspectionScopedTables().map(getTableName));
        expect(names.has('inspection_tombstones')).toBe(false);
        expect(names.has('inspection_results')).toBe(true);
    });

    describe('tombstone', () => {
        const OTHER_TENANT = '00000000-0000-0000-0000-000000000002';
        const tombstones = () => testDb.select().from(schema.inspectionTombstones).all();

        it('records exactly one (tenant, id) row, none for another company, and still empties the child tables', async () => {
            await testDb.insert(schema.inspectionResults).values({
                id: 'res-t', tenantId: TENANT, inspectionId: INSP, data: '{}',
                lastSyncedAt: new Date(), createdAt: new Date(),
            } as never);

            await deleteInspectionCascade(testDb as unknown as DrizzleD1Database, makeR2([]).bucket, TENANT, INSP);

            const rows = await tombstones();
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({ tenantId: TENANT, inspectionId: INSP });
            expect(rows[0]!.deletedAt).toBeInstanceOf(Date);
            // Control: the tombstone is not a leftover of "nothing was deleted".
            expect(await testDb.select().from(schema.inspections).all()).toHaveLength(0);
            expect(await testDb.select().from(schema.inspectionResults).all()).toHaveLength(0);
        });

        it('deleting the same id again is not an error and leaves one row', async () => {
            const db = testDb as unknown as DrizzleD1Database;
            await deleteInspectionCascade(db, makeR2([]).bucket, TENANT, INSP);
            await deleteInspectionCascade(db, makeR2([]).bucket, TENANT, INSP);
            expect(await tombstones()).toHaveLength(1);
        });

        it("a company's tombstone does not appear under another company that deletes an inspection with a different id", async () => {
            await testDb.insert(schema.tenants).values({
                id: OTHER_TENANT, slug: 'other', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
            });
            await testDb.insert(schema.inspections).values({
                id: 'i-other', tenantId: OTHER_TENANT, propertyAddress: '9 St', date: '2026-06-01',
                status: 'requested', paymentStatus: 'unpaid', price: 0,
                agreementRequired: false, paymentRequired: false, createdAt: new Date(),
            });
            await deleteInspectionCascade(testDb as unknown as DrizzleD1Database, makeR2([]).bucket, TENANT, INSP);
            const rows = await tombstones();
            expect(rows.map((r) => [r.tenantId, r.inspectionId])).toEqual([[TENANT, INSP]]);
            // Control: the other company's inspection is untouched.
            expect(await testDb.select().from(schema.inspections).all()).toHaveLength(1);
        });

        it('refuses the delete when the tombstone cannot be written, and removes nothing', async () => {
            await testDb.insert(schema.inspectionResults).values({
                id: 'res-f', tenantId: TENANT, inspectionId: INSP, data: '{}',
                lastSyncedAt: new Date(), createdAt: new Date(),
            } as never);
            const r2 = makeR2([{ key: `${TENANT}/inspections/${INSP}/photos/m-1.jpg`, size: 1 }]);
            sqlite.exec('DROP TABLE inspection_tombstones');

            await expect(deleteInspectionCascade(testDb as unknown as DrizzleD1Database, r2.bucket, TENANT, INSP)).rejects.toThrow();

            expect(await testDb.select().from(schema.inspections).all()).toHaveLength(1);
            expect(await testDb.select().from(schema.inspectionResults).all()).toHaveLength(1);
            expect(r2.deleted).toEqual([]);
        });
    });

    describe('unfinished video uploads', () => {
        const upload = (id: string, inspectionId: string, state: 'open' | 'completing' | 'completed') => ({
            id, tenantId: TENANT, inspectionId, mediaId: `m-${id}`, userId: 'u-1', uploadId: `up-${id}`, r2Key: `${TENANT}/inspections/${inspectionId}/videos/${id}.mp4`,
            contentType: 'video/mp4' as const, totalBytes: 10, partBytes: 5, partCount: 2, state, createdAt: new Date(), expiresAt: new Date(Date.now() + 3600_000),
        });
        const part = (mediaId: string, n: number) => ({ tenantId: TENANT, mediaId, partNumber: n, etag: 'e', sizeBytes: 5, receivedAt: new Date() });
        function r2WithAbort(failAbort = false) {
            const aborted: string[] = [];
            const base = makeR2([]);
            const bucket = {
                ...base.bucket,
                resumeMultipartUpload: (key: string, uploadId: string) => ({
                    abort: async () => { aborted.push(`${key}|${uploadId}`); if (failAbort) throw new Error('r2 down'); },
                }),
            } as unknown as R2Bucket;
            return { bucket, aborted };
        }
        async function seed() {
            await testDb.insert(schema.inspections).values({
                id: 'i-2', tenantId: TENANT, propertyAddress: '2 St', date: '2026-06-02', status: 'requested', paymentStatus: 'unpaid', price: 0,
                agreementRequired: false, paymentRequired: false, createdAt: new Date(),
            } as never);
            await testDb.insert(schema.videoUploads).values([upload('a', INSP, 'open'), upload('b', INSP, 'completed'), upload('c', 'i-2', 'open')]);
            await testDb.insert(schema.videoUploadParts).values([part('m-a', 1), part('m-a', 2), part('m-c', 1)]);
        }

        it('aborts the open upload once, removes its ledger row and parts, and leaves the other inspection upload alone', async () => {
            await seed();
            const r2 = r2WithAbort();
            await deleteInspectionCascade(testDb as unknown as DrizzleD1Database, r2.bucket, TENANT, INSP);
            expect(r2.aborted).toEqual([`${TENANT}/inspections/${INSP}/videos/a.mp4|up-a`]);
            expect((await testDb.select().from(schema.videoUploads).all()).map((r) => r.id)).toEqual(['c']);
            expect((await testDb.select().from(schema.videoUploadParts).all()).map((r) => r.mediaId)).toEqual(['m-c']);
        });

        it('a failed abort does not fail the delete', async () => {
            await seed();
            const r2 = r2WithAbort(true);
            await deleteInspectionCascade(testDb as unknown as DrizzleD1Database, r2.bucket, TENANT, INSP);
            expect(r2.aborted).toHaveLength(1);
            expect((await testDb.select().from(schema.inspections).all()).map((x) => x.id)).toEqual(['i-2']);
            expect((await testDb.select().from(schema.videoUploadParts).all()).map((r) => r.mediaId)).toEqual(['m-c']);
        });
    });

    describe('a delete that fails after the tombstone was written', () => {
        it('leaves the inspection in place, and a retried delete completes', async () => {
            const db = testDb as unknown as DrizzleD1Database;
            const failing = { list: async () => { throw new Error('r2 list failed'); }, delete: async () => undefined } as unknown as R2Bucket;
            await expect(deleteInspectionCascade(db, failing, TENANT, INSP)).rejects.toThrow('r2 list failed');
            expect(await testDb.select().from(schema.inspections).all()).toHaveLength(1);
            expect(await testDb.select().from(schema.inspectionTombstones).all()).toHaveLength(1);

            await deleteInspectionCascade(db, makeR2([]).bucket, TENANT, INSP);
            expect(await testDb.select().from(schema.inspections).all()).toHaveLength(0);
            expect(await testDb.select().from(schema.inspectionTombstones).all()).toHaveLength(1);
        });
    });

    /**
     * A published report's courtesy translation dies with the inspection.
     *
     * The retention catalogue excludes `report_translations` from the calendar
     * sweep on the ground that a translation has no lifetime of its own and
     * dies when its report does. For a time the code did not implement that:
     * the cascade's child set is DERIVED from tables carrying `inspection_id`,
     * this table is keyed by `report_id`, so the reports were deleted and the
     * translated copy of their text stayed behind under an id nothing resolved.
     * A retention answer whose whole ground is "it dies with its report" is
     * worth nothing while the code lets it outlive the report.
     *
     * The DSAR half of the same guarantee is held by
     * `tests/unit/privacy/report-translation-erasure.spec.ts`. Both paths are
     * required; neither substitutes for the other, because a subject erasure is
     * requested and an inspection deletion is routine.
     */
    it('deletes a report translation with the inspection that owns its report', async () => {
        await testDb.insert(schema.reports).values({
            id: 'rep-1', tenantId: TENANT, inspectionId: INSP, kind: 'primary',
            title: 'Report', status: 'published', createdAt: new Date(), publishedAt: new Date(),
        } as never);
        // A second inspection with its own published report and translation.
        // Without it, an executor that deleted the whole table would pass every
        // assertion below.
        await testDb.insert(schema.inspections).values({
            id: 'i-2', tenantId: TENANT, propertyAddress: '2 St', date: '2026-06-02',
            status: 'requested', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as never);
        await testDb.insert(schema.reports).values({
            id: 'rep-2', tenantId: TENANT, inspectionId: 'i-2', kind: 'primary',
            title: 'Other', status: 'published', createdAt: new Date(), publishedAt: new Date(),
        } as never);
        const translation = (id: string, reportId: string) => ({
            id, tenantId: TENANT, reportId, locale: 'es-419',
            content: '["texto"]', source: 'openai-compatible:byo',
            englishHash: 'h-en', translatedHash: 'h-es', noticeVersion: 1,
            aiCallId: `ai-${id}`, generatedAt: new Date(),
        });
        await testDb.insert(schema.reportTranslations).values([
            translation('tr-1', 'rep-1'),
            translation('tr-2', 'rep-2'),
        ] as never);

        const r2 = makeR2([]);
        await deleteInspectionCascade(testDb as unknown as DrizzleD1Database, r2.bucket, TENANT, INSP);

        const left = await testDb.select().from(schema.reportTranslations).all();
        expect(left.map((t) => t.id)).toEqual(['tr-2']);
        // And the report it belonged to really did go, so the assertion above
        // is about a translation outliving its parent rather than about a
        // deletion that never ran.
        expect((await testDb.select().from(schema.reports).all()).map((r) => r.id)).toEqual(['rep-2']);
    });

    /**
     * The hand-written hop above is only correct for the tables it knows about.
     *
     * `report_translations` is handled explicitly because a translation's owner
     * is the DOCUMENT, and reshaping the domain model to suit a cascade is the
     * wrong trade — give it an `inspection_id` and the derived set would cover
     * it, at the cost of a key that lies about what owns the row. The price of that choice is that
     * the next `report_id`-keyed table will NOT be picked up automatically.
     *
     * So this asserts the shape the choice depends on. A new table keyed by a
     * report and not by an inspection turns this red, which is the moment
     * somebody has to decide whether the cascade needs a second hop.
     */
    it('report_translations is the only report-keyed table the derived set cannot see', () => {
        const inspectionScoped = new Set(inspectionScopedTables().map(getTableName));
        // `as unknown[]` first, the same way `scoped-tables.ts` does it: the
        // schema barrel exports constants as well as tables, so the narrowing
        // predicate has to start from a type wide enough to hold both.
        const reportKeyedOnly = (Object.values(schema) as unknown[])
            .filter((t): t is SQLiteTable => is(t, SQLiteTable))
            .filter((t) => 'reportId' in getTableColumns(t))
            .map(getTableName)
            .filter((name) => !inspectionScoped.has(name))
            .sort();
        expect(reportKeyedOnly).toEqual(['report_translations']);
    });
});
