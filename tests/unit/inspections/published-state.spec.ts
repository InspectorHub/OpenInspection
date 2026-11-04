/**
 * "Published vN, unpublished edits" is DERIVED: `publishedVersionNumber` + `editingAgain` read off the primary report and
 * its versions, never stored. Real in-memory database, real service.
 *
 *   draft              -> null, false
 *   published          -> latest version, false
 *   edit again         -> latest version, true   (clients still read that version)
 *   retracted (legacy) -> null, false            (report row still says published, the order does not)
 *
 * Every refusal has a positive control, and the list reads the states in ONE extra query, not one per row.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InspectionCoreService } from '../../../server/services/inspection/inspection-core.service';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { loadPublishedStates, loadPublishedStateWithLock, NOT_PUBLISHED } from '../../../server/lib/inspection/published-state';
import { isContentLocked, isReportContentLocked } from '../../../server/lib/inspection/report-lock';
import { listReportsForHub } from '../../../server/lib/inspection/reports';
import { ALL_INSPECTIONS } from '../../../server/lib/inspection/visibility';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import { lazyD1 } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

const testD1 = lazyD1();
const T1 = 't1-published-state';
const T2 = 't2-published-state';

const DRAFT = 'insp-draft';
const PUBLISHED = 'insp-published';
const EDITING = 'insp-editing';
const RETRACTED = 'insp-retracted';
const OTHER = 'insp-other-tenant';
const NO_ROW = 'insp-published-no-report-row';
const ODD = 'insp-published-order-draft-report';
const GAPS = 'insp-version-gaps';

describe('published state (derived)', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        testD1.use(db);
        await db.insert(schema.tenants).values([
            { id: T1, slug: T1, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: T2, slug: T2, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        const order = (id: string, tenantId: string, reportStatus: 'draft' | 'published') => ({
            id, tenantId, propertyAddress: id, date: '2026-06-01', status: 'completed' as const, reportStatus,
            paymentStatus: 'unpaid' as const, price: 0, paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });
        await db.insert(schema.inspections).values([
            order(DRAFT, T1, 'draft'), order(PUBLISHED, T1, 'published'), order(EDITING, T1, 'published'),
            order(RETRACTED, T1, 'draft'), order(OTHER, T2, 'published'),
            order(NO_ROW, T1, 'published'), order(ODD, T1, 'published'), order(GAPS, T1, 'published'),
        ] as never);
        const at = new Date('2026-06-02T00:00:00Z');
        const report = (id: string, tenantId: string, inspectionId: string, status: 'draft' | 'in_progress' | 'published', publishedAt: Date | null, kind: 'primary' | 'ancillary' = 'primary') =>
            ({ id, tenantId, inspectionId, kind, title: id, status, publishedAt, createdAt: new Date(1) });
        await db.insert(schema.reports).values([
            report(`r-${DRAFT}`, T1, DRAFT, 'draft', null),
            report(`r-${PUBLISHED}`, T1, PUBLISHED, 'published', at),
            report(`r-${EDITING}`, T1, EDITING, 'in_progress', at),
            // Retracted before reports reset themselves: the report row still says published, the order does not.
            report(`r-${RETRACTED}`, T1, RETRACTED, 'published', at),
            report(`r-${OTHER}`, T2, OTHER, 'published', at),
            // An ancillary report's versions never count toward the primary's number.
            report(`r-anc-${PUBLISHED}`, T1, PUBLISHED, 'published', at, 'ancillary'),
            // Order published, primary row a draft that was never published: the server does not lock it.
            report(`r-${ODD}`, T1, ODD, 'draft', null),
            // Primary v1 and v3 around an ancillary v2: version numbers are monotonic per order, so they have gaps.
            report(`r-${GAPS}`, T1, GAPS, 'published', at),
            report(`r-anc-${GAPS}`, T1, GAPS, 'published', at, 'ancillary'),
        ] as never);
        const version = (id: string, tenantId: string, inspectionId: string, reportId: string, n: number) => ({
            id, tenantId, inspectionId, reportId, versionNumber: n, snapshotJson: '{}', publishedAt: at, publishedBy: 'u1',
        });
        await db.insert(schema.reportVersions).values([
            version('v-p1', T1, PUBLISHED, `r-${PUBLISHED}`, 1),
            version('v-p2', T1, PUBLISHED, `r-${PUBLISHED}`, 2),
            version('v-a9', T1, PUBLISHED, `r-anc-${PUBLISHED}`, 9),
            version('v-e1', T1, EDITING, `r-${EDITING}`, 1),
            version('v-r1', T1, RETRACTED, `r-${RETRACTED}`, 1),
            version('v-o4', T2, OTHER, `r-${OTHER}`, 4),
            version('v-g1', T1, GAPS, `r-${GAPS}`, 1),
            version('v-g2', T1, GAPS, `r-anc-${GAPS}`, 2),
            version('v-g3', T1, GAPS, `r-${GAPS}`, 3),
        ]);
    });

    it('derives each state, and keeps the version number while editing again', async () => {
        const states = await loadPublishedStates(asD1Db(db), T1, [DRAFT, PUBLISHED, EDITING, RETRACTED]);
        expect(states.get(DRAFT)).toEqual({ publishedVersionNumber: null, editingAgain: false });
        // v2 is the primary's latest; the ancillary's v9 does not count.
        expect(states.get(PUBLISHED)).toEqual({ publishedVersionNumber: 2, editingAgain: false });
        expect(states.get(EDITING)).toEqual({ publishedVersionNumber: 1, editingAgain: true });
        // The retracted order keeps its versions but clients see none of them.
        expect(states.get(RETRACTED)).toEqual({ publishedVersionNumber: null, editingAgain: false });
    });

    it('is tenant-scoped: another tenant\'s order is not readable (control: its own tenant reads it)', async () => {
        expect((await loadPublishedStates(asD1Db(db), T1, [OTHER])).has(OTHER)).toBe(false);
        expect((await loadPublishedStates(asD1Db(db), T2, [OTHER])).get(OTHER)).toEqual({ publishedVersionNumber: 4, editingAgain: false });
    });

    it('reads many ids without failing on the bound-parameter limit, and ids that are not inspections are simply absent', async () => {
        const ids = Array.from({ length: 450 }, (_, i) => `missing-${i}`).concat(PUBLISHED);
        const states = await loadPublishedStates(asD1Db(db), T1, ids);
        expect(states.size).toBe(1);
        expect(states.get(PUBLISHED)?.publishedVersionNumber).toBe(2);
    });

    it('a published order whose primary report has no row yet is published, not "never published"', async () => {
        // Edit-again creates the row on demand, and the write lock already treats this order as locked: the label agrees.
        await db.insert(schema.reportVersions).values({
            id: 'v-n1', tenantId: T1, inspectionId: NO_ROW, reportId: null, versionNumber: 1, snapshotJson: '{}', publishedAt: new Date(), publishedBy: 'u1',
        });
        expect((await loadPublishedStates(asD1Db(db), T1, [NO_ROW])).get(NO_ROW)).toEqual({ publishedVersionNumber: 1, editingAgain: false });
        expect(await isReportContentLocked(asD1Db(db), T1, NO_ROW)).toBe(true);
        expect((await loadPublishedStateWithLock(asD1Db(db), T1, NO_ROW)).contentLocked).toBe(true);
    });

    describe('contentLocked is the answer the write guard gives', () => {
        // One table, asserted against the pure predicate AND against what the guard says for the same rows in the db.
        const CASES: Array<[string, string, boolean]> = [
            ['draft order and draft report', DRAFT, false],
            ['published order and published report', PUBLISHED, true],
            ['published order, report editing again', EDITING, false],
            ['retracted legacy row (report published, order draft)', RETRACTED, false],
            ['published order, primary report a never-published draft', ODD, false],
        ];
        it.each(CASES)('%s', async (_name, id, locked) => {
            expect((await loadPublishedStateWithLock(asD1Db(db), T1, id)).contentLocked).toBe(locked);
            expect(await isReportContentLocked(asD1Db(db), T1, id)).toBe(locked);
        });

        it('the pure predicate gives the same table', () => {
            const at = new Date(1);
            expect(isContentLocked({ status: 'published', publishedAt: at, orderStatus: 'published' })).toBe(true);
            expect(isContentLocked({ status: 'in_progress', publishedAt: at, orderStatus: 'published' })).toBe(false);
            expect(isContentLocked({ status: 'draft', publishedAt: null, orderStatus: 'published' })).toBe(false);
            expect(isContentLocked({ status: 'published', publishedAt: at, orderStatus: 'draft' })).toBe(false);
            expect(isContentLocked({ status: null, orderStatus: 'published' })).toBe(true);
            expect(isContentLocked({ status: null, orderStatus: 'draft' })).toBe(false);
        });
    });

    it('the hub names the same version as the list when version numbers have gaps (primary v1, v3 around an ancillary v2)', async () => {
        const hub = await listReportsForHub(asD1Db(db), T1, GAPS);
        const primary = hub.find((r) => r.kind === 'primary')!;
        // versionCount (2) is what the hub used to show; the number a reader means is v3.
        expect(primary.versionCount).toBe(2);
        expect(primary.latestVersionNumber).toBe(3);
        expect(hub.find((r) => r.kind === 'ancillary')!.latestVersionNumber).toBe(2);
        expect((await loadPublishedStates(asD1Db(db), T1, [GAPS])).get(GAPS)?.publishedVersionNumber).toBe(primary.latestVersionNumber);
    });

    describe('listInspections', () => {
        function makeSvc() {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sdb = new ScopedDB(db as any, T1);
            return new InspectionCoreService(testD1.binding, undefined, sdb);
        }

        it('carries the two fields on every row, from one batched read', async () => {
            const { inspections } = await makeSvc().listInspections(T1, { limit: 20 }, ALL_INSPECTIONS);
            const byId = new Map(inspections.map((i) => [i.id, i]));
            expect(byId.get(PUBLISHED)).toMatchObject({ publishedVersionNumber: 2, editingAgain: false });
            expect(byId.get(EDITING)).toMatchObject({ publishedVersionNumber: 1, editingAgain: true });
            expect(byId.get(DRAFT)).toMatchObject({ ...NOT_PUBLISHED });
            expect(byId.get(RETRACTED)).toMatchObject({ ...NOT_PUBLISHED });
            expect(byId.has(OTHER)).toBe(false);
        });

        it('issues the same number of report_versions reads for 1 row as for 4 (no N+1)', async () => {
            const counted = async (limit: number) => {
                let n = 0;
                const real = testD1.binding.prepare.bind(testD1.binding);
                (testD1.binding as { prepare: unknown }).prepare = (sql: string) => { if (/report_versions/i.test(sql)) n += 1; return real(sql); };
                try { await makeSvc().listInspections(T1, { limit }, ALL_INSPECTIONS); } finally { (testD1.binding as { prepare: unknown }).prepare = real; }
                return n;
            };
            const one = await counted(1);
            const many = await counted(20);
            expect(one).toBeGreaterThan(0);
            expect(many).toBe(one);
        });
    });
});
