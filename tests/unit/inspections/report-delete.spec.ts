/**
 * Deleting a report is the one irreversible action in per-deliverable delivery.
 *
 * A report is not a row. It owns an `inspection_results` document — the
 * findings AND the Yjs state two people may have been typing into — and its own
 * `report_versions` chain. There are no foreign keys by policy, so nothing in
 * the database notices the orphans a naive delete leaves, and nothing notices a
 * delete that reaches into a SIBLING report's document either.
 *
 * The two refusals are the load-bearing part. The primary report is what the
 * collab route resolves an inspection to, failing closed without one, so
 * deleting it does not remove a document — it makes the order uneditable. A
 * published report has been delivered and its signed versions are what let a
 * client verify the document they hold.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { deleteReport, listReportsForHub, reportDeleteBlock } from '../../../server/lib/inspection/reports';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-0000000000d1';
const INSPECTION = 'insp-delete';

let db: BetterSQLite3Database<typeof schema>;
const asD1 = () => db as unknown as DrizzleD1Database;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Delete Co', slug: 'delete-co', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
    await db.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT, propertyAddress: '9 Deliverable Way',
        date: '2026-08-04', status: 'scheduled', reportStatus: 'in_progress',
        paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false,
        createdAt: new Date(),
    } as never);
});

/** A report plus the document that belongs to it, bound on `report_id`. */
async function seedReport(
    id: string,
    over: Partial<typeof schema.reports.$inferInsert> = {},
    data: Record<string, unknown> = {},
) {
    await db.insert(schema.reports).values({
        id, tenantId: TENANT, inspectionId: INSPECTION, kind: 'ancillary',
        title: id, status: 'in_progress', createdAt: new Date(), sortOrder: 0, ...over,
    } as never);
    await db.insert(schema.inspectionResults).values({
        id: `res-${id}`, tenantId: TENANT, inspectionId: INSPECTION, reportId: id,
        data, lastSyncedAt: new Date(),
    } as never);
    return id;
}

describe('deleting a report', () => {
    it('removes the report and the document that belongs only to it', async () => {
        await seedReport('rep-primary', { kind: 'primary', title: 'Inspection Report' });
        await seedReport('rep-sewer', { title: 'Sewer Scope' }, { 'item-1': { rating: 'defect' } });

        await deleteReport(asD1(), TENANT, INSPECTION, 'rep-sewer');

        const remaining = await db.select().from(schema.reports).all();
        expect(remaining.map((r) => r.id)).toEqual(['rep-primary']);
        const results = await db.select().from(schema.inspectionResults).all();
        expect(
            results.map((r) => r.reportId),
            'the deleted report left its document behind, bound to nothing',
        ).toEqual(['rep-primary']);
    });

    it('leaves a sibling report document untouched', async () => {
        // The reason `inspection_results.report_id` has to be bound at creation.
        // A delete keyed on inspection_id alone takes every document on the
        // order with it, and NOTHING reports an error — the sewer report simply
        // opens empty the next time somebody looks at it.
        await seedReport('rep-primary', { kind: 'primary' }, { 'item-a': { rating: 'ok' } });
        await seedReport('rep-radon', { title: 'Radon Testing' });

        await deleteReport(asD1(), TENANT, INSPECTION, 'rep-radon');

        const survivor = await db.select().from(schema.inspectionResults)
            .where(eq(schema.inspectionResults.reportId, 'rep-primary')).get();
        expect(survivor, "the primary report's document was collateral damage").toBeTruthy();
        const data = typeof survivor!.data === 'string'
            ? JSON.parse(survivor!.data) as Record<string, unknown>
            : survivor!.data as Record<string, unknown>;
        expect(Object.keys(data)).toEqual(['item-a']);
    });

    it('takes its version chain with it, leaving no orphans', async () => {
        await seedReport('rep-primary', { kind: 'primary' });
        await seedReport('rep-sewer');
        await db.insert(schema.reportVersions).values({
            id: 'ver-1', tenantId: TENANT, inspectionId: INSPECTION, reportId: 'rep-sewer',
            versionNumber: 1, snapshotJson: '{}', publishedAt: new Date(), publishedBy: 'u1',
            createdAt: new Date(),
        } as never);

        await deleteReport(asD1(), TENANT, INSPECTION, 'rep-sewer');

        expect(await db.select().from(schema.reportVersions).all()).toHaveLength(0);
    });

    it('refuses the primary report — the order would become uneditable', async () => {
        await seedReport('rep-primary', { kind: 'primary' });
        await expect(deleteReport(asD1(), TENANT, INSPECTION, 'rep-primary'))
            .rejects.toThrow(/primary report cannot be deleted/i);
        expect(await db.select().from(schema.reports).all()).toHaveLength(1);
    });

    it('refuses a published report — it has been delivered and signed', async () => {
        await seedReport('rep-primary', { kind: 'primary' });
        await seedReport('rep-radon', { title: 'Radon Testing', status: 'published', publishedAt: new Date() });

        await expect(deleteReport(asD1(), TENANT, INSPECTION, 'rep-radon'))
            .rejects.toThrow(/published report cannot be deleted/i);
        expect(await db.select().from(schema.reports).all()).toHaveLength(2);
    });

    it('leaves the billing line that produced it alone', async () => {
        // Deleting the deliverable does not un-sell the work, and the invoice is
        // authoritative over the line sum regardless.
        await db.insert(schema.services).values({
            id: 'svc-sewer', tenantId: TENANT, name: 'Sewer Scope', price: 20000,
            active: true, sortOrder: 1, createdAt: new Date(),
        } as never);
        await db.insert(schema.inspectionServices).values({
            id: 'line-sewer', tenantId: TENANT, inspectionId: INSPECTION, serviceId: 'svc-sewer',
            nameSnapshot: 'Sewer Scope', priceSnapshot: 20000, active: true,
        } as never);
        await seedReport('rep-primary', { kind: 'primary' });
        await seedReport('rep-sewer', { inspectionServiceId: 'line-sewer' });

        await deleteReport(asD1(), TENANT, INSPECTION, 'rep-sewer');

        const lines = await db.select().from(schema.inspectionServices).all();
        expect(lines).toHaveLength(1);
        expect(lines[0]!.active).toBe(true);
    });

    it('404s for a report belonging to another inspection', async () => {
        await seedReport('rep-primary', { kind: 'primary' });
        await expect(deleteReport(asD1(), TENANT, 'some-other-inspection', 'rep-primary'))
            .rejects.toThrow(/not found/i);
    });
});

describe('what the list tells the UI', () => {
    it('answers canDelete with the same rule the endpoint enforces', async () => {
        await seedReport('rep-primary', { kind: 'primary', title: 'Inspection Report', sortOrder: 0 });
        await seedReport('rep-sewer', { title: 'Sewer Scope', sortOrder: 1 }, { 'item-1': {} });
        await seedReport('rep-radon', { title: 'Radon Testing', sortOrder: 2, status: 'published', publishedAt: new Date() });

        const list = await listReportsForHub(asD1(), TENANT, INSPECTION);

        expect(list.map((r) => r.title)).toEqual(['Inspection Report', 'Sewer Scope', 'Radon Testing']);
        expect(list.map((r) => r.canDelete)).toEqual([false, true, false]);
        expect(list.map((r) => r.deleteBlockedReason)).toEqual(['primary', null, 'published']);
        // "Information you already filled out" is the phrase the confirmation
        // has to be honest about, so it comes from the document, not a guess.
        expect(list.map((r) => r.hasContent)).toEqual([false, true, false]);
    });

    it('counts the signed versions a delete would destroy', async () => {
        await seedReport('rep-primary', { kind: 'primary' });
        await seedReport('rep-sewer');
        for (const n of [1, 2]) {
            await db.insert(schema.reportVersions).values({
                id: `ver-${n}`, tenantId: TENANT, inspectionId: INSPECTION, reportId: 'rep-sewer',
                versionNumber: n, snapshotJson: '{}', publishedAt: new Date(), publishedBy: 'u1',
                createdAt: new Date(),
            } as never);
        }

        const list = await listReportsForHub(asD1(), TENANT, INSPECTION);
        expect(list.find((r) => r.id === 'rep-sewer')!.versionCount).toBe(2);
        expect(list.find((r) => r.id === 'rep-primary')!.versionCount).toBe(0);
    });

    it('is the single source of the rule — the pure predicate agrees', async () => {
        expect(reportDeleteBlock({ kind: 'primary', status: 'in_progress' })).toBe('primary');
        expect(reportDeleteBlock({ kind: 'ancillary', status: 'published' })).toBe('published');
        expect(reportDeleteBlock({ kind: 'ancillary', status: 'in_progress' })).toBeNull();
    });
});
