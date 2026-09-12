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

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
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
