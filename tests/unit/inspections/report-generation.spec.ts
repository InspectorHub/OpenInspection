/**
 * Selling the services produces the reports.
 *
 * Before this, an order was born with ONE placeholder report and nothing ever
 * created a second, so the `reports` entity could model a radon report but no
 * code path could produce one. These specs pin the three things that decide
 * whether generation is safe to run: it happens once, at the point the work is
 * scheduled to begin, and it never re-titles or re-templates a document
 * somebody has already written into.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import {
    REPORT_COUNT_SOFT_CEILING,
    generateReportsForServices,
    onScheduledStart,
    reportCountWarnings,
    sweepScheduledReportGeneration,
} from '../../../server/lib/inspection/report-generation';
import { createPrimaryReport, listReports } from '../../../server/lib/inspection/reports';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-0000000000r1';
const INSPECTION = 'insp-generation';

let db: BetterSQLite3Database<typeof schema>;
/** The unit-test driver stands in for the D1 one; every call site is identical. */
const asD1 = () => db as unknown as DrizzleD1Database;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Generation Co', slug: 'generation-co', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    } as never);
});

async function seedInspection(over: Partial<typeof schema.inspections.$inferInsert> = {}) {
    await db.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT, propertyAddress: '1 Deliverable Way',
        date: '2026-08-03', status: 'scheduled', reportStatus: 'in_progress',
        paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false,
        createdAt: new Date(), ...over,
    } as never);
}

async function seedTemplate(id: string) {
    await db.insert(schema.templates).values({
        id, tenantId: TENANT, name: id, version: 1, schema: { schemaVersion: 2, sections: [] },
        createdAt: new Date(),
    } as never);
}

/** A catalogue entry plus the line that sells it on this order. */
async function sellService(
    key: string,
    name: string,
    opts: { templateId?: string | null; sortOrder?: number; inspectionId?: string } = {},
) {
    if (opts.templateId) await seedTemplate(opts.templateId);
    await db.insert(schema.services).values({
        id: `svc-${key}`, tenantId: TENANT, name, price: 30000,
        templateId: opts.templateId ?? null, active: true,
        sortOrder: opts.sortOrder ?? 0, createdAt: new Date(),
    } as never);
    await db.insert(schema.inspectionServices).values({
        id: `line-${key}`, tenantId: TENANT, inspectionId: opts.inspectionId ?? INSPECTION,
        serviceId: `svc-${key}`, nameSnapshot: name, priceSnapshot: 30000, active: true,
    } as never);
}

describe('report generation from sold services', () => {
    it('creates one report per sold service, in catalogue order, with the service default template', async () => {
        await seedInspection();
        await createPrimaryReport(db, TENANT, INSPECTION, null);
        await sellService('standard', 'Standard Home Inspection', { templateId: 'tpl-standard', sortOrder: 1 });
        await sellService('sewer', 'Sewer Scope', { templateId: 'tpl-sewer', sortOrder: 2 });
        await sellService('radon', 'Radon Testing', { templateId: 'tpl-radon', sortOrder: 3 });

        await onScheduledStart(asD1(), TENANT, INSPECTION);

        const rows = await listReports(asD1(), TENANT, INSPECTION);
        expect(rows.map((r) => r.title))
            .toEqual(['Standard Home Inspection', 'Sewer Scope', 'Radon Testing']);
        expect(rows.map((r) => r.templateId)).toEqual(['tpl-standard', 'tpl-sewer', 'tpl-radon']);
        // The first line takes over the placeholder the order was born with,
        // rather than leaving an untitled fourth report beside the three real
        // ones — and there is still exactly one primary.
        expect(rows.filter((r) => r.kind === 'primary')).toHaveLength(1);
        expect(rows[0]!.kind).toBe('primary');
        expect(rows.map((r) => r.inspectionServiceId))
            .toEqual(['line-standard', 'line-sewer', 'line-radon']);
    });

    it('does not retro-template an existing order', async () => {
        await seedInspection();
        await createPrimaryReport(db, TENANT, INSPECTION, null);
        await sellService('standard', 'Standard Home Inspection', { templateId: 'tpl-standard' });
        await generateReportsForServices(asD1(), TENANT, INSPECTION);
        const before = await listReports(asD1(), TENANT, INSPECTION);

        // A default configured today must not replace a document already filled in.
        await seedTemplate('tpl-brand-new');
        await db.update(schema.services).set({ templateId: 'tpl-brand-new' })
            .where(eq(schema.services.id, 'svc-standard'));
        await generateReportsForServices(asD1(), TENANT, INSPECTION);

        expect(await listReports(asD1(), TENANT, INSPECTION)).toEqual(before);
    });

    it('gives a service added after generation its own report', async () => {
        await seedInspection();
        await createPrimaryReport(db, TENANT, INSPECTION, null);
        await sellService('standard', 'Standard Home Inspection', { sortOrder: 1 });
        await generateReportsForServices(asD1(), TENANT, INSPECTION);

        // Scope changes at the door are routine. Reconciling again must add the
        // new deliverable without disturbing the one already in progress.
        await sellService('sewer', 'Sewer Scope', { sortOrder: 2 });
        const result = await generateReportsForServices(asD1(), TENANT, INSPECTION);

        expect(result.created).toBe(1);
        expect((await listReports(asD1(), TENANT, INSPECTION)).map((r) => r.title))
            .toEqual(['Standard Home Inspection', 'Sewer Scope']);
    });

    it('leaves a primary somebody has written into alone, and gives the line its own report', async () => {
        await seedInspection();
        await seedTemplate('tpl-booked');
        await createPrimaryReport(db, TENANT, INSPECTION, 'tpl-booked');
        const primary = (await listReports(asD1(), TENANT, INSPECTION))[0]!;
        await db.insert(schema.inspectionResults).values({
            id: 'res-touched', tenantId: TENANT, inspectionId: INSPECTION,
            reportId: primary.id, data: { roof: { rating: 'defect' } }, lastSyncedAt: new Date(),
        } as never);
        await sellService('standard', 'Standard Home Inspection', { templateId: 'tpl-standard' });

        await generateReportsForServices(asD1(), TENANT, INSPECTION);

        const rows = await listReports(asD1(), TENANT, INSPECTION);
        expect(rows).toHaveLength(2);
        const kept = rows.find((r) => r.id === primary.id)!;
        expect(kept.title).toBe('Inspection Report');
        expect(kept.templateId).toBe('tpl-booked');
        expect(kept.inspectionServiceId).toBeNull();
    });

    it('warns past the practical ceiling but enforces nothing', async () => {
        await seedInspection();
        await createPrimaryReport(db, TENANT, INSPECTION, null);
        for (let i = 0; i < REPORT_COUNT_SOFT_CEILING + 1; i += 1) {
            await sellService(`svc${i}`, `Service ${String(i).padStart(2, '0')}`, { sortOrder: i });
        }

        const result = await generateReportsForServices(asD1(), TENANT, INSPECTION);

        expect(await listReports(asD1(), TENANT, INSPECTION))
            .toHaveLength(REPORT_COUNT_SOFT_CEILING + 1);
        expect(result.warnings).toContainEqual(expect.stringMatching(/15/));
    });

    it('says nothing at the ceiling itself', () => {
        expect(reportCountWarnings(REPORT_COUNT_SOFT_CEILING)).toEqual([]);
        expect(reportCountWarnings(REPORT_COUNT_SOFT_CEILING + 1)).toHaveLength(1);
    });

    it('ignores a line the client declined at the door', async () => {
        await seedInspection();
        await createPrimaryReport(db, TENANT, INSPECTION, null);
        await sellService('standard', 'Standard Home Inspection', { sortOrder: 1 });
        await sellService('pool', 'Pool Inspection', { sortOrder: 2 });
        await db.update(schema.inspectionServices).set({ active: false })
            .where(eq(schema.inspectionServices.id, 'line-pool'));

        await generateReportsForServices(asD1(), TENANT, INSPECTION);

        expect((await listReports(asD1(), TENANT, INSPECTION)).map((r) => r.title))
            .toEqual(['Standard Home Inspection']);
    });
});

describe('the scheduled-start sweep', () => {
    const NOW = Date.parse('2026-08-03T15:00:00.000Z');

    it('generates for an order whose start has arrived, and not for one still weeks away', async () => {
        await seedInspection({ scheduledStartMs: new Date(NOW - 60_000) } as never);
        await createPrimaryReport(db, TENANT, INSPECTION, null);
        await sellService('standard', 'Standard Home Inspection');

        await db.insert(schema.inspections).values({
            id: 'insp-future', tenantId: TENANT, propertyAddress: '2 Later Lane',
            date: '2026-09-01', status: 'scheduled', reportStatus: 'in_progress',
            paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false,
            createdAt: new Date(), scheduledStartMs: new Date(NOW + 7 * 86_400_000),
        } as never);
        await createPrimaryReport(db, TENANT, 'insp-future', null);
        await sellService('sewer', 'Sewer Scope', { inspectionId: 'insp-future' });

        const swept = await sweepScheduledReportGeneration(asD1(), NOW);

        expect(swept).toBe(1);
        expect((await listReports(asD1(), TENANT, INSPECTION)).map((r) => r.title))
            .toEqual(['Standard Home Inspection']);
        // The future order keeps the placeholder it was born with: a report that
        // materialises weeks early freezes a template the tenant may still edit.
        expect((await listReports(asD1(), TENANT, 'insp-future')).map((r) => r.title))
            .toEqual(['Inspection Report']);
    });

    it('is a no-op the second time it runs', async () => {
        await seedInspection({ scheduledStartMs: new Date(NOW - 60_000) } as never);
        await createPrimaryReport(db, TENANT, INSPECTION, null);
        await sellService('standard', 'Standard Home Inspection');

        expect(await sweepScheduledReportGeneration(asD1(), NOW)).toBe(1);
        expect(await sweepScheduledReportGeneration(asD1(), NOW)).toBe(0);
    });

    it('skips a cancelled order', async () => {
        await seedInspection({ scheduledStartMs: new Date(NOW - 60_000), status: 'cancelled' } as never);
        await createPrimaryReport(db, TENANT, INSPECTION, null);
        await sellService('standard', 'Standard Home Inspection');

        expect(await sweepScheduledReportGeneration(asD1(), NOW)).toBe(0);
    });
});
