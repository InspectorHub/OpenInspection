/**
 * The `reports` entity — one order, several reports.
 *
 * A standard inspection publishes today and the radon report publishes on
 * Thursday, each with its own document. `uq_results_inspection` made that
 * impossible; this table is the thing it becomes.
 *
 * The one-primary rule is enforced by a partial UNIQUE INDEX rather than by the
 * service layer, because "which report does the client mean by my report" must
 * not depend on which caller wrote last.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

const TENANT = 'tenant-reports-1';
const INSP = 'insp-reports-1';
const OTHER_INSP = 'insp-reports-2';

describe('reports', () => {
    let db: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;

    const addReport = (over: Partial<typeof schema.reports.$inferInsert> = {}) =>
        db.insert(schema.reports).values({
            id: over.id ?? `r-${Math.random().toString(36).slice(2)}`,
            tenantId: TENANT,
            inspectionId: INSP,
            kind: 'ancillary',
            title: 'Report',
            status: 'in_progress',
            createdAt: new Date(),
            ...over,
        } as never);

    const listFor = (inspectionId: string) =>
        db.select().from(schema.reports)
            .where(and(eq(schema.reports.tenantId, TENANT), eq(schema.reports.inspectionId, inspectionId)))
            .all();

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
    });

    afterEach(() => { sqlite.close(); });

    it('allows several reports on one inspection', async () => {
        // The entire point. uq_results_inspection made this impossible.
        await addReport({ id: 'r-primary', kind: 'primary', title: 'Home Inspection Report' });
        await addReport({ id: 'r-radon', kind: 'ancillary', title: 'Radon Test Report' });

        expect(await listFor(INSP)).toHaveLength(2);
    });

    it('allows exactly one primary report per inspection', async () => {
        await addReport({ id: 'r-p1', kind: 'primary', title: 'Home Inspection Report' });
        await expect(addReport({ id: 'r-p2', kind: 'primary', title: 'Duplicate' }))
            .rejects.toThrow();
    });

    it('does not limit how many ancillary reports an inspection has', async () => {
        // The uniqueness is PARTIAL — a job can deliver radon, sewer and mould.
        await addReport({ id: 'r-a1', title: 'Radon' });
        await addReport({ id: 'r-a2', title: 'Sewer Scope' });
        await addReport({ id: 'r-a3', title: 'Mold' });

        expect(await listFor(INSP)).toHaveLength(3);
    });

    it('scopes the one-primary rule to its own inspection', async () => {
        // Two different orders each get their own primary; the index keys on
        // inspection_id, not on the tenant.
        await addReport({ id: 'r-p1', kind: 'primary', title: 'A' });
        await addReport({ id: 'r-p2', kind: 'primary', title: 'B', inspectionId: OTHER_INSP });

        expect(await listFor(INSP)).toHaveLength(1);
        expect(await listFor(OTHER_INSP)).toHaveLength(1);
    });

    it('defaults a new report to in_progress', async () => {
        await addReport({ id: 'r-new', title: 'Radon' });
        const row = await db.select().from(schema.reports)
            .where(eq(schema.reports.id, 'r-new')).get();
        expect(row?.status).toBe('in_progress');
    });

    it('carries the billing LINE, not the catalogue entry', async () => {
        // inspection_service_id is `inspection_services.id`. Storing a
        // `services.id` here would make "which report did this billing line
        // produce" unanswerable, which is the grain pay splits are built on.
        await addReport({ id: 'r-line', title: 'Radon', inspectionServiceId: 'insp-svc-42' });
        const row = await db.select().from(schema.reports)
            .where(eq(schema.reports.id, 'r-line')).get();
        expect(row?.inspectionServiceId).toBe('insp-svc-42');
    });

    it('allows a report with no billing line', async () => {
        // A tenant may produce a report for something they did not bill for.
        await addReport({ id: 'r-free', title: 'Courtesy re-check' });
        const row = await db.select().from(schema.reports)
            .where(eq(schema.reports.id, 'r-free')).get();
        expect(row?.inspectionServiceId).toBeNull();
    });
});
