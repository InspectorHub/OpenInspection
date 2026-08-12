// tests/unit/reports/psq-responses.spec.ts
//
// `psq_responses` holds the ASTM E2018 §8.5 Pre-Survey Questionnaire — the
// point-of-contact's own account of the property's history, and a MANDATORY
// exhibit of a full PCA. The behaviour the table exists for is therefore not
// "store some answers": it is that the questionnaire's fate is always on the
// record. Obtained, refused, or never returned, the report has to be able to
// say which, because the conformance verdict downstream reads that status and a
// missing exhibit only stays conformant when it was DISCLOSED.
//
// Existing coverage stops at the happy path (pca-compliance-service.spec.ts:
// upsert then read; compliance-routes.spec.ts: the decline -> Deviations
// side-effect). What was untested is the storage-level invariants those two
// rest on, which is what this file pins.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComplianceService } from '../../../server/services/compliance/pca-compliance.service';
import { PCA_INSPECTION_ID } from '../../seed-fixtures';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

describe('pre-survey questionnaire (ASTM E2018 §8.5)', () => {
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
            { id: 't2', slug: 't2', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        svc = new ComplianceService({} as D1Database, 'test-encryption-secret-32-bytes-long!!');
    });

    it('an inspection nobody sent a questionnaire for reads as null, not as an empty exhibit', async () => {
        // Every downstream reader branches on presence: the report appends its
        // PSQ line only when a row exists, and deriveConformanceInput takes
        // `psq?.status ?? null`. A service that returned a blank row for an
        // inspection with no questionnaire would make "never asked" render
        // identically to "asked and got nothing back".
        const { psq } = await svc.getCompliance('t1', PCA_INSPECTION_ID);
        expect(psq).toBeNull();
    });

    it('a declined questionnaire is RECORDED, so the omission can be disclosed', async () => {
        // The refusal is the exhibit. If declining left no row, the report would
        // be indistinguishable from one where the questionnaire was never part
        // of the engagement — and the §11.4.3 disclosure that keeps such a
        // report conformant would have nothing to point at.
        await svc.setPsqStatus('t1', PCA_INSPECTION_ID, 'declined');

        const { psq } = await svc.getCompliance('t1', PCA_INSPECTION_ID);
        expect(psq).not.toBeNull();
        expect(psq?.status).toBe('declined');
        // No answers, and that is the point — status carries the information.
        expect(psq?.responses).toBeNull();
    });

    it('declining after answers already arrived does not delete the answers', async () => {
        // Whatever the point-of-contact did return stays on the record. The
        // status column is what changes; erasing the responses would destroy the
        // evidence the report was partly built on.
        await svc.upsertPsq('t1', PCA_INSPECTION_ID, { occupancyRate: '92%' });
        await svc.setPsqStatus('t1', PCA_INSPECTION_ID, 'declined');

        const { psq } = await svc.getCompliance('t1', PCA_INSPECTION_ID);
        expect(psq?.status).toBe('declined');
        expect(psq?.responses).toEqual({ occupancyRate: '92%' });
    });

    it('re-answering replaces the exhibit in place — one questionnaire per inspection', async () => {
        // §8.5 asks for THE questionnaire, not an audit log of drafts. A second
        // row would give the report two exhibits and no rule for choosing.
        await svc.upsertPsq('t1', PCA_INSPECTION_ID, { yearsOwned: 8 });
        await svc.upsertPsq('t1', PCA_INSPECTION_ID, { yearsOwned: 9, occupancyRate: '92%' });

        const rows = await testDb.select().from(schema.psqResponses).all();
        expect(rows).toHaveLength(1);
        const { psq } = await svc.getCompliance('t1', PCA_INSPECTION_ID);
        expect(psq?.responses).toEqual({ yearsOwned: 9, occupancyRate: '92%' });
        expect(psq?.status).toBe('received');
    });

    it('the same inspection id under a second tenant is a DIFFERENT questionnaire', async () => {
        // `uq_psq_inspection` is on (tenant_id, inspection_id), and this is what
        // that second column buys. Keyed on inspection_id alone, the upsert below
        // would have overwritten tenant 1's answers with tenant 2's — one
        // property owner's disclosures landing in another company's report.
        await svc.upsertPsq('t1', PCA_INSPECTION_ID, { owner: 'tenant-one-answers' });
        await svc.upsertPsq('t2', PCA_INSPECTION_ID, { owner: 'tenant-two-answers' });

        const rows = await testDb.select().from(schema.psqResponses).all();
        expect(rows).toHaveLength(2);
        expect((await svc.getCompliance('t1', PCA_INSPECTION_ID)).psq?.responses)
            .toEqual({ owner: 'tenant-one-answers' });
        expect((await svc.getCompliance('t2', PCA_INSPECTION_ID)).psq?.responses)
            .toEqual({ owner: 'tenant-two-answers' });
    });

    it('receiving answers stamps received_at and leaves sent_at alone', async () => {
        // Both are `timestamp_ms` columns; the seconds-vs-milliseconds mistake
        // that the retired PCA seeder made writes a 10-digit number that every
        // reader renders as 1970, and nothing else in the stack notices. The
        // assertion is on the magnitude, not on an exact instant.
        await svc.upsertPsq('t1', PCA_INSPECTION_ID, { yearsOwned: 8 });

        const [stored] = await testDb.select().from(schema.psqResponses).all();
        expect(stored.receivedAt).toBeInstanceOf(Date);
        expect(stored.receivedAt!.getUTCFullYear()).toBeGreaterThan(2000);
        expect(stored.updatedAt.getUTCFullYear()).toBeGreaterThan(2000);
        // Answers that came back unprompted were never "sent" — the column stays
        // null rather than being backfilled with the receive time.
        expect(stored.sentAt).toBeNull();
    });
});
