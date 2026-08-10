/**
 * The inspector's report-level narrative (`reports.inspector_narrative`).
 *
 * WHY THIS FIELD NEEDED A SPEC OF ITS OWN, rather than a line in the report
 * CRUD tests. The residential report had NO report-level prose field anywhere,
 * and the two things that look like one are not:
 *
 *   - `report_versions.summary` is the per-publish AMENDMENT REASON. It is one
 *     join away, it is a nullable text column, and it is called `summary` —
 *     everything about it invites being written into by mistake. The tests
 *     below hold both values apart at the same time and publish through them.
 *   - a `textarea` ITEM. Items are the inspection's data points: they feed the
 *     rating statistics and the defect filters, so prose about the whole report
 *     stored as an item is counted as one more thing that was inspected.
 *
 * And the field carries professional liability, so a model may draft it but
 * never BE it — which is why the last block here proves an `ai_content_reviews`
 * row can name it as its artifact.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import {
    getReportNarrative,
    setReportNarrative,
    listReportsForHub,
} from '../../../server/lib/inspection/reports';
import { recordContentReview } from '../../../server/lib/ai/content-review';
import { AiContentReviewSchema } from '../../../server/lib/validations/ai.schema';
import { ReportVersionService } from '../../../server/services/report-version.service';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-00000000na01';
const OTHER_TENANT = '00000000-0000-0000-0000-00000000na02';
const INSPECTION = 'insp-narrative';
const REPORT = 'rep-primary';

const NARRATIVE =
    'The home is in generally sound condition for its age. The roof covering is near ' +
    'the end of its service life and the main panel has two double-tapped breakers; ' +
    'both are itemised below.';
const AMENDMENT_REASON = 'Corrected the panel manufacturer in section 4.';

let db: BetterSQLite3Database<typeof schema>;
const asD1 = () => db as unknown as DrizzleD1Database;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    // Both `recordContentReview` and `ReportVersionService` reach for
    // `drizzle(d1)` themselves; point that at the in-memory database.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(db);

    for (const [id, name] of [[TENANT, 'Narrative Co'], [OTHER_TENANT, 'Someone Else']]) {
        await db.insert(schema.tenants).values({
            id, name, slug: id, status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as never);
    }
    await db.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT, propertyAddress: '9 Deliverable Way',
        date: '2026-08-09', status: 'scheduled', reportStatus: 'in_progress',
        paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false,
        createdAt: new Date(),
    } as never);
    await db.insert(schema.reports).values({
        id: REPORT, tenantId: TENANT, inspectionId: INSPECTION, kind: 'primary',
        title: 'Inspection Report', status: 'in_progress', createdAt: new Date(), sortOrder: 0,
    } as never);
    await db.insert(schema.inspectionResults).values({
        id: 'res-1', tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT,
        data: {}, lastSyncedAt: new Date(),
    } as never);
});

const storedNarrative = async () =>
    (await db.select({ n: schema.reports.inspectorNarrative }).from(schema.reports)
        .where(eq(schema.reports.id, REPORT)).get())?.n ?? null;

describe('the narrative round-trips through the read/write path', () => {
    it('what is written is what is read back', async () => {
        const returned = await setReportNarrative(asD1(), TENANT, INSPECTION, REPORT, NARRATIVE);
        expect(returned).toBe(NARRATIVE);
        expect(await getReportNarrative(asD1(), TENANT, INSPECTION, REPORT)).toBe(NARRATIVE);
    });

    it('a report with no narrative reads null, not an empty string', async () => {
        expect(await getReportNarrative(asD1(), TENANT, INSPECTION, REPORT)).toBeNull();
    });

    it('clearing it stores NULL, so "cleared" is not a third state', async () => {
        await setReportNarrative(asD1(), TENANT, INSPECTION, REPORT, NARRATIVE);
        await setReportNarrative(asD1(), TENANT, INSPECTION, REPORT, '   ');
        expect(
            await storedNarrative(),
            'a blank save stored whitespace; readers now have to distinguish "" from null',
        ).toBeNull();
        expect(await getReportNarrative(asD1(), TENANT, INSPECTION, REPORT)).toBeNull();
    });

    it('the hub list reports whether a narrative exists', async () => {
        const before = await listReportsForHub(asD1(), TENANT, INSPECTION);
        expect(before[0]!.hasNarrative).toBe(false);
        await setReportNarrative(asD1(), TENANT, INSPECTION, REPORT, NARRATIVE);
        const after = await listReportsForHub(asD1(), TENANT, INSPECTION);
        expect(after[0]!.hasNarrative).toBe(true);
    });

    it('another tenant cannot read or write it', async () => {
        await setReportNarrative(asD1(), TENANT, INSPECTION, REPORT, NARRATIVE);
        await expect(getReportNarrative(asD1(), OTHER_TENANT, INSPECTION, REPORT)).rejects.toThrow();
        await expect(
            setReportNarrative(asD1(), OTHER_TENANT, INSPECTION, REPORT, 'not yours'),
        ).rejects.toThrow();
        expect(await storedNarrative()).toBe(NARRATIVE);
    });
});

describe('the narrative is not report_versions.summary', () => {
    it('both hold different values at the same time', async () => {
        await setReportNarrative(asD1(), TENANT, INSPECTION, REPORT, NARRATIVE);
        await db.insert(schema.reportVersions).values({
            id: 'ver-1', tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT,
            versionNumber: 1, snapshotJson: '{}', summary: AMENDMENT_REASON,
            isAmendment: true, publishedAt: new Date(), publishedBy: 'user-a',
            createdAt: new Date(),
        } as never);

        const narrative = await getReportNarrative(asD1(), TENANT, INSPECTION, REPORT);
        const reason = (await db.select({ s: schema.reportVersions.summary })
            .from(schema.reportVersions).where(eq(schema.reportVersions.id, 'ver-1')).get())?.s;

        // Printed side by side on purpose: two values that are supposed to be
        // independent are only proven independent when they are unequal while
        // both are set. Equal values here would pass a weaker assertion.
        expect({ narrative, reason }).toEqual({ narrative: NARRATIVE, reason: AMENDMENT_REASON });
    });

    it('publishing an amendment does not overwrite the narrative', async () => {
        await setReportNarrative(asD1(), TENANT, INSPECTION, REPORT, NARRATIVE);

        const svc = new ReportVersionService({} as D1Database, 'test-encryption-secret-key');
        await svc.snapshotOnPublish(TENANT, INSPECTION, 'user-a', undefined, REPORT);
        const amended = await svc.snapshotOnPublish(
            TENANT, INSPECTION, 'user-a', AMENDMENT_REASON, REPORT,
        );

        expect(amended.versionNumber).toBe(2);
        expect(amended.summary).toBe(AMENDMENT_REASON);
        expect(
            await getReportNarrative(asD1(), TENANT, INSPECTION, REPORT),
            'publishing an amendment rewrote the inspector narrative with the amendment reason',
        ).toBe(NARRATIVE);
    });

    it('writing the narrative does not touch any amendment reason', async () => {
        await db.insert(schema.reportVersions).values({
            id: 'ver-1', tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT,
            versionNumber: 1, snapshotJson: '{}', summary: AMENDMENT_REASON,
            isAmendment: true, publishedAt: new Date(), publishedBy: 'user-a',
            createdAt: new Date(),
        } as never);

        await setReportNarrative(asD1(), TENANT, INSPECTION, REPORT, NARRATIVE);

        const reason = (await db.select({ s: schema.reportVersions.summary })
            .from(schema.reportVersions).where(eq(schema.reportVersions.id, 'ver-1')).get())?.s;
        expect(reason).toBe(AMENDMENT_REASON);
    });
});

describe('AI review evidence can name the narrative', () => {
    const AI_CALL = 'call-1';

    const reviews = () => db.select().from(schema.aiContentReviews)
        .where(eq(schema.aiContentReviews.tenantId, TENANT)).all();

    /**
     * ⚠️ THE DECLARATION, CHECKED AT RUNTIME, AND THIS IS THE ASSERTION THAT
     * ACTUALLY BINDS.
     *
     * The drizzle `{ enum: [...] }` is TYPE-LAYER ONLY — no CHECK constraint
     * reaches the DDL, which is the whole reason the Schema Rules call it free.
     * So an insert of `'report'` against a one-member enum stores happily and
     * every write test below still passes: this suite was verified green with
     * the member REMOVED before these two cases were added. A spec that inserts
     * a value and reads it back proves nothing about the enum; only reading the
     * declaration does.
     */
    it("the schema enum really carries a 'report' member", () => {
        expect(schema.aiContentReviews.artifactType.enumValues)
            .toEqual(['inspection_result', 'report']);
    });

    it("the request schema accepts artifact_type 'report'", () => {
        const parsed = AiContentReviewSchema.safeParse({
            artifactType: 'report', artifactId: REPORT, aiCallId: AI_CALL,
        });
        expect(parsed.success).toBe(true);
        // And still refuses a member nobody declared — the point of enumerating
        // at all is that a value naming no real table cannot get in.
        expect(AiContentReviewSchema.safeParse({
            artifactType: 'report_version', artifactId: REPORT, aiCallId: AI_CALL,
        }).success).toBe(false);
    });

    it("an ai_content_reviews row can be written with artifact_type 'report'", async () => {
        await recordContentReview({
            db: {} as D1Database,
            tenantId: TENANT,
            artifactType: 'report',
            artifactId: REPORT,
            reviewedBy: 'user-a',
            aiCallId: AI_CALL,
        });

        const rows = await reviews();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.artifactType).toBe('report');
        expect(
            rows[0]!.artifactId,
            'the review must cite the reports row that holds the narrative',
        ).toBe(REPORT);
    });

    it('the review resolves to the report that actually holds the narrative', async () => {
        // The whole value of the enum member: `artifact_type` + `artifact_id`
        // must land on a real row with a real narrative column. A member naming
        // a table that has no home for prose is the defect the schema comment
        // rejected `report_version` for.
        await setReportNarrative(asD1(), TENANT, INSPECTION, REPORT, NARRATIVE);
        await recordContentReview({
            db: {} as D1Database, tenantId: TENANT, artifactType: 'report',
            artifactId: REPORT, reviewedBy: 'user-a', aiCallId: AI_CALL,
        });

        const row = (await reviews())[0]!;
        const target = await db.select().from(schema.reports)
            .where(and(eq(schema.reports.tenantId, row.tenantId), eq(schema.reports.id, row.artifactId)))
            .get();
        expect(target?.inspectorNarrative).toBe(NARRATIVE);
    });

    it('a retried review is still a no-op, and the two artifact types do not collide', async () => {
        const args = {
            db: {} as D1Database, tenantId: TENANT, reviewedBy: 'user-a', aiCallId: AI_CALL,
        };
        await recordContentReview({ ...args, artifactType: 'report', artifactId: REPORT });
        await recordContentReview({ ...args, artifactType: 'report', artifactId: REPORT });
        // Same person, same call, same id string — but a DIFFERENT table. That
        // is a different fact and must not be swallowed by the idempotency key.
        await recordContentReview({ ...args, artifactType: 'inspection_result', artifactId: REPORT });

        const rows = await reviews();
        expect(rows.map((r) => r.artifactType).sort()).toEqual(['inspection_result', 'report']);
    });
});
