// tests/unit/reports/document-review-items.spec.ts
//
// `document_review_items` is the ASTM E2018 §8.6 owner/user document checklist.
// Until this spec it had no test that named the behaviour it exists FOR: the
// checklist is a disclosure instrument. A document that was asked for and never
// arrived is a limitation on the assessment, and §8.6 says a limitation must be
// stated rather than dropped. Everything below is about that one rule — the
// column round-trip is not the interesting part, what the reader of the finished
// report is told about a gap is.
//
// The rows the fixture writes for `PCA_INSPECTION_ID` (tests/seed-fixtures.ts,
// SEED_PCA=1) were chosen to be exactly the four states this file distinguishes.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    documentReviewNarrativeItems,
    documentReviewStatusPhrase,
    type DocumentReviewRow,
} from '../../../server/lib/pca-document-review';
import { DOCUMENT_REVIEW_CATALOG } from '../../../server/lib/pca-document-catalog';
import { ComplianceService } from '../../../server/services/compliance/pca-compliance.service';
import { PCA_INSPECTION_ID } from '../../seed-fixtures';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const row = (over: Partial<DocumentReviewRow> = {}): DocumentReviewRow => ({
    label: 'Certificate of Occupancy',
    requested: false, received: false, reviewed: false, na: false, notes: null,
    ...over,
});

describe('document review — every checklist row is disclosed (ASTM E2018 §8.6)', () => {
    it('a document that was never requested is still a line in the report', () => {
        const items = documentReviewNarrativeItems([
            row({ label: 'Appraisals' }),
            row({ label: 'Rent roll', requested: true, received: true, reviewed: true }),
        ], null);

        // Two rows in, two lines out. A filter here — "only show what we have" —
        // is the failure this asserts against: it would leave the report silently
        // claiming a narrower scope than the checklist recorded.
        expect(items).toHaveLength(2);
        expect(items[0]).toEqual({ label: 'Appraisals', narrative: 'Not requested' });
    });

    it('a document marked N/A reads as a decision, and carries the reason with it', () => {
        // N/A is not a gap — it is a judgement that the document does not apply
        // to this property. A reader chasing outstanding documents must be able
        // to tell the two apart, and the reason is what makes the judgement
        // reviewable rather than an assertion.
        const [item] = documentReviewNarrativeItems([
            row({
                label: 'Environmental reports (Phase I/II ESA)',
                na: true,
                notes: 'Phase I ESA not commissioned for this engagement.',
            }),
        ], null);

        expect(item.narrative).toBe('N/A — Phase I ESA not commissioned for this engagement.');
        expect(item.narrative).not.toContain('Not requested');
    });

    it('received-but-not-reviewed says Received and never claims Reviewed', () => {
        // The three flags are independent claims, not one progress value. A
        // document sitting unread is a real disclosure: the assessment did not
        // rest on it. Collapsing "received" into "reviewed" would overstate the
        // work done, which is the direction of error §8.6 cares about.
        const phrase = documentReviewStatusPhrase(
            row({ requested: true, received: true, reviewed: false }),
        );
        expect(phrase).toBe('Requested, Received');
        expect(phrase).not.toContain('Reviewed');

        expect(documentReviewStatusPhrase(
            row({ requested: true, received: true, reviewed: true }),
        )).toBe('Requested, Received, Reviewed');
    });

    it('an empty checklist row never renders as blank text', () => {
        // A row with nothing ticked has to SAY something. An empty cell reads as
        // a formatting slip and gets ignored; "Not requested" is the statement.
        expect(documentReviewStatusPhrase(row())).toBe('Not requested');
    });

    it('the PSQ is appended as its own line, including when it was declined', () => {
        // §8.5's questionnaire shares this narrative block, and `declined` is the
        // single status worth printing loudest — it is the one the conformance
        // verdict then requires a Deviations disclosure for.
        const items = documentReviewNarrativeItems([row()], { status: 'declined' });
        expect(items).toHaveLength(2);
        expect(items[1]).toEqual({
            label: 'Pre-Survey Questionnaire (PSQ)',
            narrative: 'Status: declined',
        });
    });

    it('an inspection with no questionnaire gets no PSQ line at all', () => {
        // Absent is not the same as declined, and must not be printed as a status.
        const items = documentReviewNarrativeItems([row()], null);
        expect(items.map((i) => i.label)).not.toContain('Pre-Survey Questionnaire (PSQ)');
    });
});

describe('document review — the seeded checklist is the whole catalog', () => {
    let svc: ComplianceService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values([
            { id: 't1', slug: 't1', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        svc = new ComplianceService({} as D1Database, 'test-encryption-secret-32-bytes-long!!');
    });

    it('seeding writes one row per catalog entry — the catalog IS the disclosure universe', async () => {
        // The existing service spec only asserts "more than zero". That passes on
        // a catalog someone trimmed to one entry, and a trimmed catalog is a
        // report that discloses less while looking just as complete. Both numbers
        // go in the assertion so a shrink is visible.
        await svc.seedDocumentReview('t1', PCA_INSPECTION_ID);
        const { documentReview } = await svc.getCompliance('t1', PCA_INSPECTION_ID);

        expect(DOCUMENT_REVIEW_CATALOG.length).toBeGreaterThan(0);
        expect(documentReview).toHaveLength(DOCUMENT_REVIEW_CATALOG.length);
        expect(documentReview.map((d) => d.documentKey).sort())
            .toEqual(DOCUMENT_REVIEW_CATALOG.map((d) => d.documentKey).slice().sort());
    });

    it('a seeded row starts as an open request, not as a completed one', async () => {
        // The default matters: a checklist that seeded itself as `reviewed` would
        // let a report claim a document review nobody performed.
        await svc.seedDocumentReview('t1', PCA_INSPECTION_ID);
        const { documentReview } = await svc.getCompliance('t1', PCA_INSPECTION_ID);
        expect(documentReview.every((d) => !d.requested && !d.received && !d.reviewed && !d.na)).toBe(true);
    });

    it('marking a document N/A keeps its row, so the decision survives into the report', async () => {
        // The tempting implementation is to drop the row. Then the report cannot
        // say the document was considered, and the next reviewer requests it again.
        await svc.seedDocumentReview('t1', PCA_INSPECTION_ID);
        await svc.updateDocumentReviewItem('t1', PCA_INSPECTION_ID, 'appraisals', {
            na: true, notes: 'Outside transaction scope.',
        });

        const { documentReview } = await svc.getCompliance('t1', PCA_INSPECTION_ID);
        expect(documentReview).toHaveLength(DOCUMENT_REVIEW_CATALOG.length);
        const item = documentReview.find((d) => d.documentKey === 'appraisals');
        expect(item?.na).toBe(true);
        expect(documentReviewStatusPhrase({
            label: item?.label ?? '', requested: !!item?.requested, received: !!item?.received,
            reviewed: !!item?.reviewed, na: !!item?.na, notes: item?.notes ?? null,
        })).toBe('N/A');
    });

    it('one tenant cannot read another tenant\'s checklist for the same inspection id', async () => {
        await svc.seedDocumentReview('t1', PCA_INSPECTION_ID);
        const { documentReview } = await svc.getCompliance('t2', PCA_INSPECTION_ID);
        expect(documentReview).toHaveLength(0);
    });
});
