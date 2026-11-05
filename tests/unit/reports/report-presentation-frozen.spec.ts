/**
 * A published version freezes how the report is PRESENTED, not only what it says: the defect category colours (and which
 * categories drive the Summary) and the time zone its dates are printed in.
 *
 * Both used to be read live, so a company changing them after a publish changed the client's page while the cached PDF
 * (keyed by the version) kept the old look. Each case changes the company's settings AFTER the snapshot and asserts the
 * pinned read did not move, paired with the live read of the same change so a test whose change never happened fails there.
 * A snapshot written before the `presentation` part (version 3 and earlier) falls back to the live values for these two.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { InspectionService } from '../../../server/services/inspection.service';
import { ReportVersionService } from '../../../server/services/report-version.service';
import { assertSnapshotSize } from '../../../server/lib/report-snapshot-build';
import { frozenPresentation } from '../../../server/lib/report-freeze';
import { SNAPSHOT_SCHEMA_VERSION, type Snapshot } from '../../../server/lib/version-diff';
import { resolveClientPdfTarget } from '../../../server/lib/client-pdf-target';
import { formatInspectionDateTime } from '../../../packages/field-ui/src/shared/format-date';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000079';
const TEMPLATE_ID = '22222222-2222-2222-2222-222222222279';
const INSPECTION = '11111111-1111-1111-1111-1111111179aa';
const REPORT = '33333333-3333-3333-3333-333333333379';

const TEMPLATE_SCHEMA = {
    schemaVersion: 2,
    sections: [{
        id: 'roof', title: 'Roof',
        items: [{ id: 'roof-shingles', label: 'Shingles', tabs: { defects: [{ id: 'd1', comment: 'Curling at the ridge', category: 'safety', default: true }] } }],
    }],
};

const SAFETY_RED = '#ef4444';
const REPAINTED = '#00aa55';

describe('a published version freezes its presentation', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let svc: InspectionService;
    let versions: ReportVersionService;

    /** Freezes the current state as the report's next version, the way a publish does. */
    async function publishVersion(versionNumber: number, snapshotJson?: string) {
        await db.insert(schema.reportVersions).values({
            id: crypto.randomUUID(), tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT, versionNumber,
            snapshotJson: snapshotJson ?? await versions.buildSnapshotJson(TENANT, INSPECTION, REPORT),
            publishedAt: new Date(), publishedBy: 'u1', verificationToken: `token-v${versionNumber}`, contentHash: `hash-v${versionNumber}`,
        });
    }
    const setZone = (zone: string) => db.update(schema.tenantConfigs).set({ defaultTimezone: zone }).where(eq(schema.tenantConfigs.tenantId, TENANT));
    const repaint = (color: string) => db.update(schema.defectCategories).set({ color })
        .where(and(eq(schema.defectCategories.tenantId, TENANT), eq(schema.defectCategories.name, 'safety')));
    const chip = (report: Awaited<ReturnType<InspectionService['getReportData']>>) => JSON.stringify(report.sections);

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        svc = new InspectionService({} as D1Database);
        versions = new ReportVersionService({} as D1Database, 'secret', []);
        await db.insert(schema.tenants).values({ id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
        await db.insert(schema.tenantConfigs).values({ tenantId: TENANT, defaultTimezone: 'America/Chicago', updatedAt: new Date() } as never);
        // The company's own category rows (without them the report reads built-in defaults and a repaint has nothing to change).
        await db.insert(schema.defectCategories).values([
            { id: 'cat-maint', tenantId: TENANT, name: 'maintenance', color: '#3b82f6', drivesSummary: false, sortOrder: 0, isSeed: true, createdAt: new Date() },
            { id: 'cat-safety', tenantId: TENANT, name: 'safety', color: SAFETY_RED, drivesSummary: true, sortOrder: 1, isSeed: true, createdAt: new Date() },
        ]);
        await db.insert(schema.templates).values({ id: TEMPLATE_ID, tenantId: TENANT, name: 'Standard', schema: TEMPLATE_SCHEMA, version: 1, createdAt: new Date() });
        await db.insert(schema.inspections).values({
            id: INSPECTION, tenantId: TENANT, templateId: TEMPLATE_ID, templateSnapshot: TEMPLATE_SCHEMA,
            propertyAddress: '12 Published Way', date: '2026-06-01T03:30:00.000Z', status: 'completed', reportStatus: 'published',
            paymentStatus: 'paid', price: 0, paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });
        await db.insert(schema.reports).values({ id: REPORT, tenantId: TENANT, inspectionId: INSPECTION, kind: 'primary', title: 'Home inspection', status: 'published', createdAt: new Date() });
        await db.insert(schema.inspectionResults).values({
            id: crypto.randomUUID(), tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT,
            data: { 'roof-shingles': { rating: 'Defect' } }, lastSyncedAt: new Date(),
        });
    });

    it('stamps the current schema version and a small presentation part (categories and zone only)', async () => {
        const snap = JSON.parse(await versions.buildSnapshotJson(TENANT, INSPECTION, REPORT)) as Snapshot;
        expect(SNAPSHOT_SCHEMA_VERSION).toBe(4);
        expect(snap.schemaVersion).toBe(4);
        expect(snap.presentation?.timeZone).toBe('America/Chicago');
        expect(snap.presentation?.defectCategories.find((c) => c.name === 'safety')).toMatchObject({ color: SAFETY_RED, drivesSummary: true });
        // Only what the renderer reads: no row ids of the company, no timestamps, no seed flags.
        expect(Object.keys(snap.presentation!.defectCategories[0]).sort()).toEqual(['color', 'drivesSummary', 'id', 'name']);
        expect(Object.keys(snap.presentation!).sort()).toEqual(['defectCategories', 'timeZone']);
        expect(() => assertSnapshotSize(JSON.stringify(snap))).not.toThrow();
    });

    it('serves the category colours as published, not as repainted since', async () => {
        await publishVersion(1);
        await repaint(REPAINTED);

        expect(chip(await svc.getReportData(INSPECTION, TENANT, undefined, undefined, 1))).toContain(SAFETY_RED);
        expect(chip(await svc.getReportData(INSPECTION, TENANT, undefined, undefined, 1))).not.toContain(REPAINTED);
        // Positive control: the same repaint IS what the live read shows.
        const live = chip(await svc.getReportData(INSPECTION, TENANT));
        expect(live).toContain(REPAINTED);
        expect(live).not.toContain(SAFETY_RED);
    });

    it('serves the time zone as published, and a date printed in it does not move', async () => {
        await publishVersion(1);
        await setZone('Asia/Tokyo');

        const pinned = await svc.getReportData(INSPECTION, TENANT, undefined, undefined, 1);
        const live = await svc.getReportData(INSPECTION, TENANT);
        expect(pinned.reportTimeZone).toBe('America/Chicago');
        expect(live.reportTimeZone).toBe('Asia/Tokyo');

        // The page prints the inspection date with this zone (ReportHeader). 03:30 UTC is the evening before in Chicago.
        const now = new Date('2026-06-15T12:00:00Z');
        const printed = (zone: string) => formatInspectionDateTime(pinned.inspection.date as string, now, zone, { locale: 'en-US' });
        expect(printed(pinned.reportTimeZone)).toContain('May');
        expect(printed(live.reportTimeZone)).toContain('Jun');
    });

    it('a version published before the part existed reads the live values, for exactly these two', async () => {
        const old = JSON.parse(await versions.buildSnapshotJson(TENANT, INSPECTION, REPORT)) as Record<string, unknown>;
        delete old.presentation;
        await publishVersion(1, JSON.stringify({ ...old, schemaVersion: 3 }));
        expect(frozenPresentation(old as unknown as Snapshot)).toBeNull();
        await repaint(REPAINTED);
        await setZone('Asia/Tokyo');
        await db.update(schema.inspectionResults).set({ data: { 'roof-shingles': { rating: 'Defect', notes: 'EDITED AFTER PUBLISH' } } as never });

        const report = await svc.getReportData(INSPECTION, TENANT, undefined, undefined, 1);
        expect(chip(report)).toContain(REPAINTED);
        expect(report.reportTimeZone).toBe('Asia/Tokyo');
        // Everything the old snapshot DID carry is still frozen.
        expect(chip(report)).not.toContain('EDITED AFTER PUBLISH');
    });

    it('a damaged category entry makes the whole part fall back to live, and the report still renders', async () => {
        for (const entry of [null, 5, { id: 'x' }, { id: 'cat-safety', name: 'safety', color: 7, drivesSummary: true }]) {
            expect(frozenPresentation({ presentation: { defectCategories: [entry], timeZone: 'UTC' } } as never)).toBeNull();
        }
        // Control: a sound entry is kept.
        expect(frozenPresentation({ presentation: { defectCategories: [{ id: 'a', name: 'a', color: '#fff', drivesSummary: false }], timeZone: 'UTC' } } as never)).not.toBeNull();

        const old = JSON.parse(await versions.buildSnapshotJson(TENANT, INSPECTION, REPORT)) as { presentation: { defectCategories: unknown[] } };
        old.presentation.defectCategories.push(null);
        await publishVersion(1, JSON.stringify(old));
        await repaint(REPAINTED);
        // Falls back to the live colours rather than throwing at `cat.name`.
        expect(chip(await svc.getReportData(INSPECTION, TENANT, undefined, undefined, 1))).toContain(REPAINTED);
    });

    it('a category deleted or renamed after publish still resolves its published colour', async () => {
        await publishVersion(1);
        await db.update(schema.defectCategories).set({ name: 'hazard', color: REPAINTED }).where(eq(schema.defectCategories.id, 'cat-safety'));
        expect(chip(await svc.getReportData(INSPECTION, TENANT, undefined, undefined, 1))).toContain(SAFETY_RED);
        await db.delete(schema.defectCategories).where(eq(schema.defectCategories.id, 'cat-safety'));
        const pinned = chip(await svc.getReportData(INSPECTION, TENANT, undefined, undefined, 1));
        expect(pinned).toContain(SAFETY_RED);
        expect(pinned).not.toContain(REPAINTED);
        // Control: the live read has lost it.
        expect(chip(await svc.getReportData(INSPECTION, TENANT))).not.toContain(SAFETY_RED);
    });

    it('a defect whose category is not in the snapshot takes the same fallback as today: no colour, and it still counts for the Summary', async () => {
        const snap = JSON.parse(await versions.buildSnapshotJson(TENANT, INSPECTION, REPORT)) as { presentation: { defectCategories: Array<{ name: string }> } };
        snap.presentation.defectCategories = snap.presentation.defectCategories.filter((c) => c.name !== 'safety');
        await publishVersion(1, JSON.stringify(snap));
        const report = await svc.getReportData(INSPECTION, TENANT, undefined, undefined, 1);
        expect(chip(report)).not.toContain(SAFETY_RED);
        expect(JSON.stringify(report.sections)).toContain('"drivesSummary":true');
    });

    it('a malformed presentation part is ignored rather than trusted', () => {
        expect(frozenPresentation({ presentation: { defectCategories: 'x', timeZone: 'UTC' } } as never)).toBeNull();
        expect(frozenPresentation({ presentation: { defectCategories: [], timeZone: '' } } as never)).toBeNull();
        expect(frozenPresentation(null)).toBeNull();
    });

    it('the PDF is read from the same pinned data: its cache key (the version hash) and its render do not move with the settings', async () => {
        await publishVersion(1);
        const hashBefore = await svc.getReportContentHash(INSPECTION, TENANT, REPORT, null, 1);
        const liveBefore = await svc.getReportContentHash(INSPECTION, TENANT, REPORT);
        const target = await resolveClientPdfTarget(db as never, TENANT, INSPECTION, async () => 'live');
        expect(target).toEqual({ versionNumber: 1, contentHash: 'hash-v1' });

        await repaint(REPAINTED);
        await setZone('Asia/Tokyo');

        // The PDF render route reads getReportData at the target's version, so it gets the old look...
        expect(await svc.getReportContentHash(INSPECTION, TENANT, REPORT, null, target.versionNumber ?? undefined)).toBe(hashBefore);
        expect(chip(await svc.getReportData(INSPECTION, TENANT, undefined, undefined, target.versionNumber ?? undefined))).toContain(SAFETY_RED);
        // ...while a live read moved (so the pin is what held it still).
        expect(await svc.getReportContentHash(INSPECTION, TENANT, REPORT)).not.toBe(liveBefore);
    });

    it('a republish after a settings change is a CHANGED publish: the snapshot differs, so the next version is real', async () => {
        const before = await versions.buildSnapshotJson(TENANT, INSPECTION, REPORT);
        expect(await versions.buildSnapshotJson(TENANT, INSPECTION, REPORT)).toBe(before);
        await repaint(REPAINTED);
        expect(await versions.buildSnapshotJson(TENANT, INSPECTION, REPORT)).not.toBe(before);
    });
});
