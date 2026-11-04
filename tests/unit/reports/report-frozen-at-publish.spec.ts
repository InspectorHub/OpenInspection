/**
 * A published report is frozen at the version that was published.
 *
 * Everything a client is shown after publish is read from that version's snapshot: the findings, the notes,
 * the photos, the unit tree and the report's content columns, plus (commercial reports) the cost lines and the
 * sign-offs. The inspector's working copy moves on in the live tables; none of it may reach the client until
 * the inspector publishes again.
 *
 * Every case edits the live rows AFTER the snapshot and asserts the pinned read did not move. Each is paired
 * with the live read of the same edit, so a test that passed because the edit never happened would fail there.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { InspectionService } from '../../../server/services/inspection.service';
import { ReportVersionService } from '../../../server/services/report-version.service';
import { SnapshotTooLargeError } from '../../../server/lib/report-snapshot-build';
import { loadLatestFrozenFindings, loadLatestPublishedRef } from '../../../server/lib/report-snapshot';
import { resolveClientPdfTarget } from '../../../server/lib/client-pdf-target';
import { generateCourtesyTranslation } from '../../../server/lib/translation/generate';
import { readTranslationState } from '../../../server/lib/translation/read-for-report';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000077';
const OTHER_TENANT = '00000000-0000-0000-0000-000000000078';
const TEMPLATE_ID = '22222222-2222-2222-2222-222222222277';
const INSPECTION = '11111111-1111-1111-1111-1111111177aa';
const REPORT = '33333333-3333-3333-3333-333333333377';

const TEMPLATE_SCHEMA = {
    schemaVersion: 2,
    sections: [{ id: 'roof', title: 'Roof', items: [{ id: 'roof-shingles', label: 'Shingles' }] }],
};

const FROZEN_NOTE = 'Shingles are curling at the ridge';
const LATER_NOTE = 'EDITED AFTER PUBLISH';

describe('a published report is frozen at its version', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: InspectionService;
    let versions: ReportVersionService;

    const RADON = '44444444-4444-4444-4444-444444444477';

    /** Freezes the current state of one report as its next version; token and hash are named after the report and version. */
    async function publishVersion(versionNumber: number, reportId: string = REPORT) {
        const snapshotJson = await versions.buildSnapshotJson(TENANT, INSPECTION, reportId);
        await testDb.insert(schema.reportVersions).values({
            id: crypto.randomUUID(), tenantId: TENANT, inspectionId: INSPECTION, reportId, versionNumber,
            snapshotJson, publishedAt: new Date(), publishedBy: 'u1', verificationToken: `token-${reportId}-v${versionNumber}`,
            contentHash: `hash-${reportId}-v${versionNumber}`,
        });
    }

    /** A second deliverable on the order, with its own findings. */
    async function addRadonReport(note = 'RADON FINDING') {
        await testDb.insert(schema.reports).values({
            id: RADON, tenantId: TENANT, inspectionId: INSPECTION, kind: 'ancillary', title: 'Radon',
            status: 'published', createdAt: new Date(), sortOrder: 1,
        });
        await testDb.insert(schema.inspectionResults).values({
            id: crypto.randomUUID(), tenantId: TENANT, inspectionId: INSPECTION, reportId: RADON, lastSyncedAt: new Date(),
            data: { 'roof-shingles': { rating: 'Satisfactory', notes: note } },
        });
    }

    const setResults = (data: Record<string, unknown>) => testDb.update(schema.inspectionResults)
        .set({ data }).where(eq(schema.inspectionResults.inspectionId, INSPECTION));

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new InspectionService({} as D1Database);
        versions = new ReportVersionService({} as D1Database, 'secret', []);
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.templates).values({
            id: TEMPLATE_ID, tenantId: TENANT, name: 'Standard', schema: TEMPLATE_SCHEMA, version: 1, createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: INSPECTION, tenantId: TENANT, templateId: TEMPLATE_ID, templateSnapshot: TEMPLATE_SCHEMA,
            propertyAddress: '12 Published Way', date: '2026-06-01', status: 'completed', reportStatus: 'published',
            paymentStatus: 'paid', price: 0, paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });
        await testDb.insert(schema.reports).values({
            id: REPORT, tenantId: TENANT, inspectionId: INSPECTION, kind: 'primary', title: 'Home inspection',
            status: 'published', createdAt: new Date(),
        });
        await testDb.insert(schema.inspectionResults).values({
            id: crypto.randomUUID(), tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT,
            data: { 'roof-shingles': { rating: 'Satisfactory', notes: FROZEN_NOTE } }, lastSyncedAt: new Date(),
        });
        await testDb.insert(schema.inspectionUnits).values({
            id: 'unit-1', tenantId: TENANT, inspectionId: INSPECTION, kind: 'unit', name: 'Unit 101', sortOrder: 1,
        });
    });

    it('serves the findings and notes as published, not as edited since', async () => {
        await publishVersion(1);
        await setResults({ 'roof-shingles': { rating: 'Defect', notes: LATER_NOTE } });

        const frozen = JSON.stringify((await svc.getReportData(INSPECTION, TENANT, undefined, undefined, 1)).sections);
        expect(frozen).toContain(FROZEN_NOTE);
        expect(frozen).not.toContain(LATER_NOTE);

        // Positive control: the same edit IS what the live read shows.
        const live = JSON.stringify((await svc.getReportData(INSPECTION, TENANT)).sections);
        expect(live).toContain(LATER_NOTE);
        expect(live).not.toContain(FROZEN_NOTE);
    });

    it('serves the unit tree as published', async () => {
        await publishVersion(1);
        await testDb.insert(schema.inspectionUnits).values({
            id: 'unit-2', tenantId: TENANT, inspectionId: INSPECTION, kind: 'unit', name: 'Unit 202', sortOrder: 2,
        });
        await testDb.update(schema.inspectionUnits).set({ name: 'Renamed unit' }).where(eq(schema.inspectionUnits.id, 'unit-1'));

        const frozen = (await svc.getReportData(INSPECTION, TENANT, undefined, undefined, 1)).units;
        expect(frozen.map((u) => u.label)).toEqual(['Unit 101']);

        const live = (await svc.getReportData(INSPECTION, TENANT)).units;
        expect(live.map((u) => u.label)).toEqual(['Renamed unit', 'Unit 202']);
    });

    it('serves the inspection content columns as published, and the order state live', async () => {
        await publishVersion(1);
        await testDb.update(schema.inspections)
            .set({ propertyAddress: '99 Moved Street', yearBuilt: 1999, reportStatus: 'in_progress' })
            .where(eq(schema.inspections.id, INSPECTION));

        const frozen = await svc.getReportData(INSPECTION, TENANT, undefined, undefined, 1);
        expect(frozen.inspection.propertyAddress).toBe('12 Published Way');
        expect(frozen.propertyFacts.yearBuilt).toBeNull();
        // The status is the order's CURRENT state and the access gate reads it; it is never frozen...
        expect(frozen.inspection.reportStatus).toBe('in_progress');
        // ...yet the document being read is a published one, so it presents as published.
        expect(frozen.isPublished).toBe(true);

        const live = await svc.getReportData(INSPECTION, TENANT);
        expect(live.inspection.propertyAddress).toBe('99 Moved Street');
        expect(live.propertyFacts.yearBuilt).toBe(1999);
        expect(live.isPublished).toBe(false);
    });

    it('keeps the content hash of a version stable while the live hash moves', async () => {
        await publishVersion(1);
        const before = await svc.getReportContentHash(INSPECTION, TENANT, REPORT, null, 1);
        const liveBefore = await svc.getReportContentHash(INSPECTION, TENANT, REPORT);
        await setResults({ 'roof-shingles': { rating: 'Defect', notes: LATER_NOTE } });

        expect(await svc.getReportContentHash(INSPECTION, TENANT, REPORT, null, 1)).toBe(before);
        expect(await svc.getReportContentHash(INSPECTION, TENANT, REPORT)).not.toBe(liveBefore);
    });

    it('lists a version\'s amendments only up to that version, with that version\'s own verification', async () => {
        await publishVersion(1);
        await setResults({ 'roof-shingles': { rating: 'Defect', notes: LATER_NOTE } });
        await publishVersion(2);

        const v1 = await svc.getReportData(INSPECTION, TENANT, undefined, undefined, 1);
        expect(v1.amendmentTrail.versions.map((v) => v.versionNumber)).toEqual([1]);
        const v2 = await svc.getReportData(INSPECTION, TENANT, undefined, undefined, 2);
        expect(v2.amendmentTrail.versions.map((v) => v.versionNumber)).toEqual([2, 1]);
        const token = (n: number) => testDb.select().from(schema.reportVersions)
            .where(eq(schema.reportVersions.versionNumber, n)).get()!.verificationToken;
        expect(v1.verification?.verifyToken).toBe(token(1));
        expect(v2.verification?.verifyToken).toBe(token(2));
    });

    it('reads the repair list at the published version, custom defects included', async () => {
        await setResults({ 'roof-shingles': { rating: 'Defect', customComments: { defects: [{ id: 'c1', title: 'Original defect', comment: 'frozen', included: true }] } } });
        await publishVersion(1);
        await setResults({ 'roof-shingles': { rating: 'Defect', customComments: { defects: [{ id: 'c2', title: 'Added later', comment: 'later', included: true }] } } });

        const frozen = (await svc.getRepairList(INSPECTION, TENANT, 1)).defects.map((d) => d.defectTitle);
        expect(frozen).toContain('Original defect');
        expect(frozen).not.toContain('Added later');
        const live = (await svc.getRepairList(INSPECTION, TENANT)).defects.map((d) => d.defectTitle);
        expect(live).toContain('Added later');
        expect(live).not.toContain('Original defect');
    });

    it('reads each report of an order at its own version 1, with its own verification and its own amendment trail', async () => {
        await addRadonReport();
        await publishVersion(1);
        await publishVersion(1, RADON);

        const primary = await svc.getReportData(INSPECTION, TENANT, undefined, undefined, 1);
        expect(JSON.stringify(primary.sections)).toContain(FROZEN_NOTE);
        expect(JSON.stringify(primary.sections)).not.toContain('RADON FINDING');
        // Another report's version 1 neither supplies the token nor makes the primary "amended".
        expect(primary.verification?.verifyToken).toBe(`token-${REPORT}-v1`);
        expect(primary.verification?.contentHash).toBe(`hash-${REPORT}-v1`);
        expect(primary.amendmentTrail.amended).toBe(false);
        expect(primary.amendmentTrail.versions).toHaveLength(1);

        const radon = await svc.getReportData(INSPECTION, TENANT, undefined, undefined, 1, RADON);
        expect(JSON.stringify(radon.sections)).toContain('RADON FINDING');
        expect(JSON.stringify(radon.sections)).not.toContain(FROZEN_NOTE);
        expect(radon.verification?.verifyToken).toBe(`token-${RADON}-v1`);
        expect(radon.amendmentTrail.amended).toBe(false);
    });

    describe('an order whose second deliverable has more versions than the primary report', () => {
        beforeEach(async () => {
            await addRadonReport();
            await publishVersion(1);               // primary v1
            await publishVersion(1, RADON);
            await setResults({ 'roof-shingles': { rating: 'Defect', notes: LATER_NOTE } });
            await publishVersion(2, RADON);        // radon v2 > primary v1
        });

        it("pins every client-facing lookup to the PRIMARY report's version", async () => {
            expect((await loadLatestPublishedRef(testDb as never, TENANT, INSPECTION))?.versionNumber).toBe(1);
            expect((await loadLatestPublishedRef(testDb as never, TENANT, INSPECTION, RADON))?.versionNumber).toBe(2);
            const latest = await versions.getLatestPublished(TENANT, INSPECTION);
            expect(latest).toMatchObject({ versionNumber: 1, contentHash: `hash-${REPORT}-v1`, verificationToken: `token-${REPORT}-v1` });
            expect(await resolveClientPdfTarget(testDb as never, TENANT, INSPECTION, async () => 'live'))
                .toEqual({ versionNumber: 1, contentHash: `hash-${REPORT}-v1` });

            // The page therefore renders the frozen primary report, not the live rows it would fall back to.
            const page = await svc.getReportData(INSPECTION, TENANT, undefined, undefined, latest!.versionNumber);
            expect(JSON.stringify(page.sections)).toContain(FROZEN_NOTE);
            expect(JSON.stringify(page.sections)).not.toContain(LATER_NOTE);
        });

        it('refuses a version that cannot be loaded instead of answering from the live tables', async () => {
            // Primary has no version 2 (radon does): the pin names nothing.
            await expect(svc.getReportData(INSPECTION, TENANT, undefined, undefined, 2)).rejects.toMatchObject({ status: 503 });
            // A stored snapshot that does not parse is the same refusal.
            await testDb.insert(schema.reportVersions).values({
                id: crypto.randomUUID(), tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT, versionNumber: 3,
                snapshotJson: '{"data":{"broken"', publishedAt: new Date(), publishedBy: 'u1',
            });
            await expect(svc.getReportData(INSPECTION, TENANT, undefined, undefined, 3)).rejects.toMatchObject({ status: 503 });
            // Control: the readable version still renders.
            await expect(svc.getReportData(INSPECTION, TENANT, undefined, undefined, 1)).resolves.toBeTruthy();
        });
    });

    it('treats a version row without a verification token as a version, in the lookup and in the pin alike', async () => {
        await testDb.insert(schema.reportVersions).values({
            id: 'old-row', tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT, versionNumber: 1,
            snapshotJson: await versions.buildSnapshotJson(TENANT, INSPECTION, REPORT), publishedAt: new Date(), publishedBy: 'u1',
        });
        expect((await loadLatestPublishedRef(testDb as never, TENANT, INSPECTION))?.versionNumber).toBe(1);
        expect(await versions.getLatestPublished(TENANT, INSPECTION)).toMatchObject({ versionNumber: 1, verificationToken: null });
    });

    const LEVELS = (label: string) => ({ levels: [{ id: 'A', label, abbreviation: 'AL', color: '#111111', severity: 'good', isDefect: false }] });
    const costLine = (id: string, component: string, order = 1) => ({
        id, tenantId: TENANT, inspectionId: INSPECTION, system: 'roof', component, location: '', action: 'repair' as const,
        costMethod: 'lump_sum' as const, lumpSumCents: 500_000, bucket: 'immediate' as const, suggestedRemedy: '', sortOrder: order,
    });
    const setRatingSystem = (label: string) => testDb.update(schema.inspectionResults)
        .set({ ratingSystemSnapshot: LEVELS(label) as never }).where(eq(schema.inspectionResults.inspectionId, INSPECTION));
    const levelLabels = (r: { ratingLevels: Array<{ label: string }> }) => r.ratingLevels.map((l) => l.label);

    it('falls back to the live rows, part by part, for a version published before those parts were in the snapshot', async () => {
        await testDb.update(schema.inspections).set({ propertyType: 'commercial', reportTier: 'light_commercial' }).where(eq(schema.inspections.id, INSPECTION));
        await testDb.insert(schema.costItems).values(costLine('c-1', 'Frozen roof line'));
        await setRatingSystem('Alpha');
        const old = JSON.parse(await versions.buildSnapshotJson(TENANT, INSPECTION, REPORT)) as Record<string, unknown>;
        for (const part of ['ratingSystemSnapshot', 'costItems', 'costYear', 'reserve', 'compliance']) delete old[part];
        await testDb.insert(schema.reportVersions).values({
            id: crypto.randomUUID(), tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT, versionNumber: 1,
            snapshotJson: JSON.stringify({ ...old, schemaVersion: 2 }), publishedAt: new Date(), publishedBy: 'u1',
        });
        await testDb.insert(schema.costItems).values(costLine('c-2', 'Added later line', 2));
        await setRatingSystem('Beta');
        await setResults({ 'roof-shingles': { rating: 'Defect', notes: LATER_NOTE } });

        const report = await svc.getReportData(INSPECTION, TENANT, undefined, undefined, 1);
        // The findings were in every snapshot, so they are frozen even in an old one...
        const sections = JSON.stringify(report.sections);
        expect(sections).toContain(FROZEN_NOTE);
        expect(sections).not.toContain(LATER_NOTE);
        // ...and exactly the parts it lacks are the live ones.
        expect(JSON.stringify(report.costTables)).toContain('Added later line');
        expect(levelLabels(report)).toEqual(['Beta']);
    });

    it('freezes a commercial report\'s cost lines and sign-offs too', async () => {
        await testDb.update(schema.inspections).set({ propertyType: 'commercial', reportTier: 'full_pca' }).where(eq(schema.inspections.id, INSPECTION));
        const cost = (id: string, component: string) => ({
            id, tenantId: TENANT, inspectionId: INSPECTION, system: 'roof', component, location: '', action: 'repair' as const,
            costMethod: 'lump_sum' as const, lumpSumCents: 500_000, bucket: 'immediate' as const, suggestedRemedy: '', sortOrder: 1,
        });
        await testDb.insert(schema.costItems).values(cost('c-1', 'Frozen roof line'));
        await setRatingSystem('Alpha');
        await testDb.insert(schema.reportSignoff).values({
            id: 's-1', tenantId: TENANT, inspectionId: INSPECTION, role: 'field_observer', personId: 'p1', name: 'Frozen Signer',
            license: 'L-1', qualificationsRef: 'q', signedAt: new Date(1_700_000_000_000), signatureRef: 'sig', dualRole: false,
        });
        await publishVersion(1);
        await testDb.insert(schema.costItems).values({ ...cost('c-2', 'Added later line'), sortOrder: 2 });
        await testDb.delete(schema.reportSignoff).where(eq(schema.reportSignoff.id, 's-1'));

        await setRatingSystem('Beta');

        const frozen = await svc.getReportData(INSPECTION, TENANT, undefined, undefined, 1);
        // The rating system the findings were rated on is the published one, even though "no rating system" is a frozen answer too.
        expect(levelLabels(frozen)).toEqual(['Alpha']);
        expect(JSON.stringify(frozen.costTables)).toContain('Frozen roof line');
        expect(JSON.stringify(frozen.costTables)).not.toContain('Added later line');
        expect(frozen.reportSignoffs.map((s) => s.name)).toEqual(['Frozen Signer']);

        const live = await svc.getReportData(INSPECTION, TENANT);
        expect(JSON.stringify(live.costTables)).toContain('Added later line');
        expect(live.reportSignoffs).toEqual([]);
        expect(levelLabels(live)).toEqual(['Beta']);
    });

    it("freezes the company's reserve-schedule assumptions with the cost opinion, and keeps the questionnaire's share token out of the record", async () => {
        await testDb.update(schema.inspections).set({ propertyType: 'commercial', reportTier: 'full_pca' }).where(eq(schema.inspections.id, INSPECTION));
        await testDb.insert(schema.tenantConfigs).values({ tenantId: TENANT, reserveScheduleEnabled: true, reserveTermYears: 12, updatedAt: new Date() } as never);
        await testDb.insert(schema.costItems).values({ ...costLine('c-long', 'Roof membrane'), bucket: 'long_term', eul: 20, effAge: 5, rul: 15 });
        await testDb.insert(schema.psqResponses).values({
            id: 'psq-1', tenantId: TENANT, inspectionId: INSPECTION, status: 'received', responses: { question: 'answer' },
            shareToken: 'SHARE-TOKEN-SECRET', updatedAt: new Date(),
        } as never);
        await publishVersion(1);
        // The company switches the schedule off afterwards.
        await testDb.update(schema.tenantConfigs).set({ reserveScheduleEnabled: false }).where(eq(schema.tenantConfigs.tenantId, TENANT));

        const stored = (await testDb.select().from(schema.reportVersions).get())!.snapshotJson;
        expect(stored).not.toContain('SHARE-TOKEN-SECRET');
        expect(stored).toContain('"reserve":{"reserveScheduleEnabled":true,"reserveTermYears":12');

        const frozen = await svc.getReportData(INSPECTION, TENANT, undefined, undefined, 1);
        expect(frozen.costTables?.reserveSchedule).toBeTruthy();
        expect(frozen.psq).toEqual({ status: 'received', responses: { question: 'answer' } });
        const live = await svc.getReportData(INSPECTION, TENANT);
        expect(live.costTables?.reserveSchedule).toBeFalsy();
    });

    describe('building the snapshot for the checks before a publish', () => {
        it('runs the builder once for the unchanged-publish comparison and the size check together', async () => {
            const builder = vi.spyOn(versions, 'buildSnapshotJson');
            const first = await versions.buildSnapshotForCheck(TENANT, INSPECTION, REPORT);
            await versions.assertSnapshotFits(TENANT, INSPECTION, REPORT);
            expect(await versions.buildSnapshotForCheck(TENANT, INSPECTION, REPORT)).toBe(first);
            expect(builder).toHaveBeenCalledTimes(1);
            // A different report is a different build, and so is the stored copy (taken after the status flip, by design).
            await versions.buildSnapshotForCheck(TENANT, INSPECTION, 'another-report');
            expect(builder).toHaveBeenCalledTimes(2);
        });
    });

    describe('the 1 MB limit on the frozen copy', () => {
        it('refuses a report whose snapshot would not fit, before it is published, naming the size', async () => {
            await setResults({ 'roof-shingles': { rating: 'Satisfactory', notes: 'x'.repeat(1_100_000) } });
            const refused = versions.assertSnapshotFits(TENANT, INSPECTION, REPORT);
            await expect(refused).rejects.toBeInstanceOf(SnapshotTooLargeError);
            await expect(refused).rejects.toThrow(/too large to publish.*limit is 1 MB/);
        });

        it('measures bytes, not characters', async () => {
            // 400k euro signs: three bytes each in UTF-8, so 400k characters but 1.2 MB stored.
            await setResults({ 'roof-shingles': { rating: 'Satisfactory', notes: '€'.repeat(400_000) } });
            await expect(versions.assertSnapshotFits(TENANT, INSPECTION, REPORT)).rejects.toBeInstanceOf(SnapshotTooLargeError);
        });

        it('accepts a report that fits', async () => {
            await expect(versions.assertSnapshotFits(TENANT, INSPECTION, REPORT)).resolves.toBeUndefined();
        });
    });

    describe('the courtesy translation follows the version the client reads', () => {
        function fakes() {
            const sent: string[][] = [];
            const stored: Array<{ englishHash: string }> = [];
            const ai = { translateSegments: vi.fn(async (a: { segments: string[] }) => {
                sent.push(a.segments);
                return { segments: a.segments.map((t) => `ES:${t}`), aiCallId: 'call-1', source: 'platform' };
            }) };
            const translations = {
                store: vi.fn(async (_t: string, _r: string, _l: string, row: { englishHash: string }) => { stored.push(row); }),
                read: vi.fn(async () => (stored.length ? { englishHash: stored[stored.length - 1]!.englishHash } : null)),
            };
            const deps = { db: {} as D1Database, ai, inspection: svc, translations } as never;
            return { deps, sent, stored };
        }

        it('is made from the published text and hashed on the published version, not the working copy', async () => {
            await publishVersion(1);
            await setResults({ 'roof-shingles': { rating: 'Defect', notes: LATER_NOTE } });
            const { deps, sent, stored } = fakes();

            await generateCourtesyTranslation(deps, { tenantId: TENANT, inspectionId: INSPECTION, locale: 'es-419' });

            expect(sent.flat().join(' ')).toContain(FROZEN_NOTE);
            expect(sent.flat().join(' ')).not.toContain(LATER_NOTE);
            expect(stored[0]!.englishHash).toBe(await svc.getReportContentHash(INSPECTION, TENANT, REPORT, null, 1));
            expect(stored[0]!.englishHash).not.toBe(await svc.getReportContentHash(INSPECTION, TENANT, REPORT));
        });

        it('stays fresh for the inspector while the working copy is edited, and goes stale when a new version is published', async () => {
            await publishVersion(1);
            const { deps } = fakes();
            await generateCourtesyTranslation(deps, { tenantId: TENANT, inspectionId: INSPECTION, locale: 'es-419' });
            const state = () => readTranslationState(deps, { tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT, locale: 'es-419' });

            await setResults({ 'roof-shingles': { rating: 'Defect', notes: LATER_NOTE } });
            expect(await state()).toBe('live');

            await publishVersion(2);
            expect(await state()).toBe('withheld');
        });
    });

    describe('the agent listing reads the primary report only', () => {
        it('counts versions within the primary report, however many the other deliverable has', async () => {
            await addRadonReport('RADON FINDING');
            // The other deliverable's rows are written FIRST, so a read that mixes reports meets them before the primary's.
            await publishVersion(1, RADON);
            await publishVersion(2, RADON);                // radon v2 > primary v1
            await publishVersion(1);                       // primary v1: the published note
            const found = await loadLatestFrozenFindings(testDb as never, [{ id: INSPECTION, tenantId: TENANT }]);
            const data = JSON.stringify(found.get(`${TENANT}:${INSPECTION}`)?.data);
            expect(data).toContain(FROZEN_NOTE);
            expect(data).not.toContain('RADON FINDING');
        });

        it('counts a version published before reports existed (no report id) as the primary report\'s', async () => {
            await addRadonReport('RADON FINDING');
            await publishVersion(1);
            await testDb.update(schema.reportVersions).set({ reportId: null }).where(eq(schema.reportVersions.reportId, REPORT));
            await publishVersion(1, RADON);
            await publishVersion(2, RADON);
            const found = await loadLatestFrozenFindings(testDb as never, [{ id: INSPECTION, tenantId: TENANT }]);
            expect(JSON.stringify(found.get(`${TENANT}:${INSPECTION}`)?.data)).toContain(FROZEN_NOTE);
        });

        it('answers a list longer than one query\'s chunk, in as many queries as chunks', async () => {
            const ids = Array.from({ length: 45 }, (_, n) => `bulk-${n}`);
            await testDb.insert(schema.inspections).values(ids.map((id) => ({
                id, tenantId: TENANT, propertyAddress: id, date: '2026-06-01', createdAt: new Date(),
            })) as never);
            await testDb.insert(schema.reportVersions).values(ids.map((id, n) => ({
                id: `rv-${id}`, tenantId: TENANT, inspectionId: id, versionNumber: 1, publishedAt: new Date(), publishedBy: 'u',
                snapshotJson: JSON.stringify({ data: { n: { notes: `note ${n}` } }, units: [], inspection: {} }),
            })) as never);
            const select = vi.spyOn(testDb, 'select');
            const found = await loadLatestFrozenFindings(testDb as never, ids.map((id) => ({ id, tenantId: TENANT })));
            expect(found.size).toBe(45);
            expect(JSON.stringify(found.get(`${TENANT}:bulk-44`)?.data)).toContain('note 44');
            expect(JSON.stringify(found.get(`${TENANT}:bulk-0`)?.data)).toContain('note 0');
            expect(select).toHaveBeenCalledTimes(2);
        });
    });

    describe('an agent reads the same frozen findings', () => {
        it('returns the latest version\'s findings per inspection, scoped to the company', async () => {
            await publishVersion(1);
            await setResults({ 'roof-shingles': { rating: 'Defect', notes: LATER_NOTE } });
            await publishVersion(2);

            const found = await loadLatestFrozenFindings(testDb as never, [{ id: INSPECTION, tenantId: TENANT }]);
            expect(JSON.stringify(found.get(`${TENANT}:${INSPECTION}`)?.data)).toContain(LATER_NOTE);
            // Version 2 froze the later edit, so the older one is not what is returned.
            expect(JSON.stringify(found.get(`${TENANT}:${INSPECTION}`)?.data)).not.toContain(FROZEN_NOTE);
            expect(found.get(`${TENANT}:${INSPECTION}`)?.templateSnapshot).toMatchObject({ schemaVersion: 2 });

            // Another company's key never matches, and an inspection with no version is simply absent.
            const other = await loadLatestFrozenFindings(testDb as never, [{ id: INSPECTION, tenantId: OTHER_TENANT }]);
            expect(other.size).toBe(0);
        });

        it('reads a version by report: two reports on one order count their own versions', async () => {
            await publishVersion(1);
            const latest = await loadLatestPublishedRef(testDb as never, TENANT, INSPECTION, REPORT);
            expect(latest?.versionNumber).toBe(1);
            expect(await loadLatestPublishedRef(testDb as never, TENANT, INSPECTION, 'some-other-report')).toBeNull();
        });
    });
});
