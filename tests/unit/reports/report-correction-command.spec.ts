/**
 * The correction command, at the end where it lands.
 *
 * `correctReport` has had its own suite since it was written, and it proved the
 * amendment machinery works. What it could not prove is that anything can ASK
 * for a correction: the service had no callers at all, so a caller that never
 * ran and a caller that ran and refused were the same observation. This file is
 * about the applier that stands between an arriving command and that service.
 *
 * ── The three endings, and why they must stay three ────────────────────────
 * A correction can be CARRIED OUT, it can be REFUSED, or it can FAIL. The
 * producer records the answer against a request with a statutory clock on it,
 * so collapsing any two of them puts an unbacked claim into that record:
 *
 *   carried out  → a reply naming the version published and the one it
 *                  supersedes. Only this may be recorded as done.
 *   refused      → a reply naming the refusal, in the refusal's own words. The
 *                  request was answered; the answer is that nothing changed.
 *                  It is NOT a completion and NOT a failure.
 *   failed       → NO REPLY AT ALL. The applier rethrows, the queue retries,
 *                  and an exhausted retry surfaces as a dead command. A reply
 *                  here could only be read as one of the two above.
 *
 * The distinction is enforced by TYPE, not by matching on a message: only
 * `CorrectionRefusedError` becomes a refusal, and everything else propagates.
 * A refusal derived from an error string would silently reclassify the day a
 * message was reworded.
 *
 * ── Every refusal case is paired with the ledger ───────────────────────────
 * "Refused" is only meaningful if nothing was published, and a report-version
 * count is the only thing that can say so. Asserting the reply alone would pass
 * against an applier that corrected the report AND reported a refusal.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import { applyReportCorrection } from '../../../server/portal/apply-report-correction';
import { ReportVersionService } from '../../../server/services/report-version.service';
import { resolveArtifactStatus } from '../../../server/lib/artifact-status';

const TENANT     = '00000000-0000-0000-0000-000000000001';
const OTHER_TEN  = '00000000-0000-0000-0000-000000000002';
const INSPECTION = '00000000-0000-0000-0000-000000000010';
const ACTOR      = '00000000-0000-0000-0000-0000000000aa';
const SECRET     = 'test-encryption-secret-key';

/** The authorising record, exactly as it arrives: the command's `replyto`. */
const AUTHORISED_BY = 'dsar:req-1';

/** Long before anything here, so an amendment published "now" is unambiguously
 *  later than a deliverable produced at this instant. */
const PRODUCED_AT = new Date('2026-01-01T00:00:00.000Z');

const DATA = {
    tenantId: TENANT,
    inspectionId: INSPECTION,
    field: 'propertyAddress' as const,
    to: '1 Main Street',
    reason: 'The address on the delivered report is not the property inspected.',
};

describe('applyReportCorrection — the applier behind cmd.report.correct', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.inspections).values({
            id: INSPECTION, tenantId: TENANT, propertyAddress: '1 Main St',
            date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
            price: 0, paymentRequired: false, agreementRequired: false,
            createdAt: new Date(),
        });
    });

    // `correctedBy` is passed as its own object rather than defaulted into the
    // parameter list: a default value cannot be overridden with `undefined`, so
    // a helper written that way makes the missing-authorisation case
    // inexpressible — and the assertion for it passes against nothing.
    const apply = (
        over: Record<string, unknown> = {},
        opts: { correctedBy?: string } = { correctedBy: AUTHORISED_BY },
    ) => applyReportCorrection({} as D1Database, SECRET, { ...DATA, ...over }, opts);

    const versionCount = async () =>
        (await db.select().from(schema.reportVersions)
            .where(eq(schema.reportVersions.inspectionId, INSPECTION)).all()).length;

    it('carries the correction out and the amendment is really in the ledger', async () => {
        await new ReportVersionService({} as D1Database, SECRET)
            .snapshotOnPublish(TENANT, INSPECTION, ACTOR);

        const reply = await apply();

        expect(reply).toEqual({
            outcome: 'corrected',
            inspectionId: INSPECTION,
            field: 'propertyAddress',
            versionNumber: 2,
            supersedes: 1,
        });

        // The far end, not the return value. A reply that names a version the
        // ledger does not hold is the failure this assertion exists to catch.
        const v2 = await db.select().from(schema.reportVersions)
            .where(and(
                eq(schema.reportVersions.inspectionId, INSPECTION),
                eq(schema.reportVersions.versionNumber, 2),
            )).get();
        expect(v2?.isAmendment).toBe(true);
        expect(v2?.summary).toBe(DATA.reason);
        // The authorising record travels onto the published version — the
        // amendment names what authorised it, not a fabricated engine user.
        expect(v2?.publishedBy).toBe(AUTHORISED_BY);

        // And the deliverables served for this inspection stop calling
        // themselves current, which is what the correction is FOR.
        expect(await resolveArtifactStatus({} as D1Database, TENANT, INSPECTION, PRODUCED_AT))
            .toBe('superseded');
    });

    it('refuses an inspection this tenant does not hold, and publishes nothing', async () => {
        const reply = await apply({ tenantId: OTHER_TEN });
        expect(reply.outcome).toBe('refused');
        expect(reply).toMatchObject({ inspectionId: INSPECTION, field: 'propertyAddress' });
        expect('reason' in reply && typeof reply.reason === 'string' && reply.reason.length).toBeTruthy();
        expect(await versionCount()).toBe(0);
    });

    it('refuses to blank a field the record requires, and publishes nothing', async () => {
        const reply = await apply({ to: '   ' });
        expect(reply.outcome).toBe('refused');
        expect(await versionCount()).toBe(0);
    });

    it('a refusal carries no version numbers at all — there is nothing to name', async () => {
        // The producer reads `outcome` to decide whether a request may be
        // recorded as done. A refusal that carried a version number would be
        // one field away from reading as a completion.
        const reply = await apply({ tenantId: OTHER_TEN });
        expect('versionNumber' in reply).toBe(false);
        expect('supersedes' in reply).toBe(false);
    });

    it('RETHROWS a transient failure instead of reporting it as a refusal', async () => {
        // A refusal is a final answer; a transient fault may succeed on the next
        // attempt. Reporting the second as the first would close a request that
        // nothing ever carried out. Simulated by removing the table the publish
        // writes to, which is a genuine driver error rather than a stubbed one.
        sqlite.exec('DROP TABLE report_versions');
        await expect(apply()).rejects.toThrow();
    });

    it('throws when the command names no authorising record', async () => {
        // `replyto` is where the authorisation comes from. Its absence is a
        // producer defect, not an answer for the data subject — so this must
        // fail visibly (retry, then a dead command) rather than publish an
        // amendment nothing can be traced back to.
        await expect(apply({}, {})).rejects.toThrow(/authorising record/i);
        expect(await versionCount()).toBe(0);
    });
});
