/**
 * One inspection can deliver SEVERAL reports — a standard one and a radon one —
 * and until this landed the render path did not know that. `getReportData` took
 * no report id and selected `inspection_results` by `(inspectionId, tenantId)`
 * with `.get()`, while `inspection_results.report_id` carries a unique index.
 * So an inspection with two results rows rendered whichever the driver handed
 * over first, and every hash consumer inherited the coin flip.
 *
 * The visible symptom is in the courtesy-translation table, which is keyed per
 * REPORT: republishing the radon report moved the inspection-grained hash and
 * withheld the standard report's translation. That is the safe direction of the
 * asymmetry, and it is still wrong.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { InspectionReportService } from '../../../server/services/inspection/inspection-report.service';

const TENANT = 't-grain';
const INSPECTION = 'insp-grain';
const PRIMARY = 'rep-primary';
const ANCILLARY = 'rep-ancillary';

const SCHEMA = {
    schemaVersion: 2,
    sections: [{
        id: 'roof',
        title: 'Roof',
        items: [{ id: 'covering', label: 'Roof covering', type: 'rich' }],
    }],
};

const finding = (notes: string, rating: string) => ({
    '_default:roof:covering': { rating, notes },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let service: InspectionReportService;

beforeEach(async () => {
    const created = createTestDb();
    await setupSchema(created.sqlite);
    db = created.db;
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'grain-tenant', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await db.insert(schema.templates).values({
        id: 'tpl-grain', tenantId: TENANT, name: 'Grain template', schema: SCHEMA,
        createdAt: new Date(), updatedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    await db.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT, templateId: 'tpl-grain',
        templateSnapshot: SCHEMA, propertyAddress: '9 Grain Row', date: '2026-08-24',
        status: 'completed', createdAt: new Date(), updatedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // TWO reports on ONE inspection. This is the case the render path could not
    // express, and the reason `uq_results_inspection` became `uq_results_report`.
    await db.insert(schema.reports).values([
        {
            id: PRIMARY, tenantId: TENANT, inspectionId: INSPECTION, kind: 'primary',
            title: 'Inspection report', status: 'published', createdAt: new Date(),
        },
        {
            id: ANCILLARY, tenantId: TENANT, inspectionId: INSPECTION, kind: 'ancillary',
            title: 'Radon report', status: 'published', createdAt: new Date(),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    await db.insert(schema.inspectionResults).values([
        {
            id: 'res-primary', tenantId: TENANT, inspectionId: INSPECTION, reportId: PRIMARY,
            data: finding('Primary finding.', 'Satisfactory'),
            createdAt: new Date(), updatedAt: new Date(), lastSyncedAt: new Date(),
        },
        {
            id: 'res-ancillary', tenantId: TENANT, inspectionId: INSPECTION, reportId: ANCILLARY,
            data: finding('Ancillary finding.', 'Defect'),
            createdAt: new Date(), updatedAt: new Date(), lastSyncedAt: new Date(),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    service = new InspectionReportService({} as unknown as D1Database);
});

describe('the render path is report-grained', () => {
    it('hashes two reports of one inspection differently', async () => {
        const primary = await service.getReportContentHash(INSPECTION, TENANT, PRIMARY);
        const ancillary = await service.getReportContentHash(INSPECTION, TENANT, ANCILLARY);
        expect(primary).not.toBe(ancillary);
        // The positive control: both are real digests, not two empty strings.
        expect(primary).toMatch(/^[0-9a-f]{64}$/);
        expect(ancillary).toMatch(/^[0-9a-f]{64}$/);
    });

    it('leaves the primary report hash alone when the ancillary report is edited', async () => {
        const before = await service.getReportContentHash(INSPECTION, TENANT, PRIMARY);
        const ancillaryBefore = await service.getReportContentHash(INSPECTION, TENANT, ANCILLARY);

        await db.update(schema.inspectionResults)
            .set({ data: finding('Edited ancillary finding.', 'Defect') })
            .where(eq(schema.inspectionResults.id, 'res-ancillary'))
            .run();

        const after = await service.getReportContentHash(INSPECTION, TENANT, PRIMARY);
        const ancillaryAfter = await service.getReportContentHash(INSPECTION, TENANT, ANCILLARY);

        expect(after).toBe(before);
        // The positive control for the assertion above: the edit really did
        // change something, so "unchanged" is not "nothing happened".
        expect(ancillaryAfter).not.toBe(ancillaryBefore);
    });

    it('resolves the PRIMARY report when no report id is given', async () => {
        // Every existing caller means the primary report; `uq_reports_primary`
        // makes that well-defined. A silent default would be the same defect in
        // a new place, so it is asserted rather than assumed.
        const implicit = await service.getReportContentHash(INSPECTION, TENANT);
        const primary = await service.getReportContentHash(INSPECTION, TENANT, PRIMARY);
        expect(implicit).toBe(primary);
    });

    it('still renders an inspection whose results row carries no report id', async () => {
        // The backfill made `report_id` nullable so it could run in order, and a
        // deployment mid-backfill must keep rendering. Absent on the row means
        // "the only results row there is", which is what every pre-reports
        // inspection looks like.
        await db.delete(schema.inspectionResults)
            .where(eq(schema.inspectionResults.id, 'res-ancillary')).run();
        await db.update(schema.inspectionResults)
            .set({ reportId: null })
            .where(eq(schema.inspectionResults.id, 'res-primary'))
            .run();

        const data = await service.getReportData(INSPECTION, TENANT, (k) => k, undefined, undefined, PRIMARY);
        expect(data.sections[0].items[0].notes).toBe('Primary finding.');
    });
});

describe('the PDF cache basis carries the translation identity', () => {
    it('hashes differently with and without a translation, and identically for the same one', async () => {
        const none = await service.getReportContentHash(INSPECTION, TENANT, PRIMARY);
        const translated = await service.getReportContentHash(
            INSPECTION, TENANT, PRIMARY, { locale: 'es-419', translatedHash: 'abc123' },
        );
        expect(translated).not.toBe(none);

        // Same identity in, same key out — otherwise every read re-renders.
        const again = await service.getReportContentHash(
            INSPECTION, TENANT, PRIMARY, { locale: 'es-419', translatedHash: 'abc123' },
        );
        expect(again).toBe(translated);

        // A different stored translation is a different document.
        const regenerated = await service.getReportContentHash(
            INSPECTION, TENANT, PRIMARY, { locale: 'es-419', translatedHash: 'def456' },
        );
        expect(regenerated).not.toBe(translated);
    });

    it('carries no provider and no credential source', async () => {
        // A translation is produced ONCE and stored; the backend that produced
        // it changes no rendered byte. Putting `source` in the basis would
        // invalidate every published PDF on a settings flip and re-render each
        // from the same stored translation — byte-identical output, for nothing.
        // Asserted structurally: the identity accepts only locale + hash.
        const a = await service.getReportContentHash(
            INSPECTION, TENANT, PRIMARY, { locale: 'es-419', translatedHash: 'same' },
        );
        const b = await service.getReportContentHash(
            INSPECTION, TENANT, PRIMARY,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { locale: 'es-419', translatedHash: 'same', source: 'openai-compatible:managed' } as any,
        );
        expect(b).toBe(a);
    });
});
