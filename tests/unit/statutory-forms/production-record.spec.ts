/**
 * A production event is the only thing that can answer "which reports used
 * revision X". `produceStatutoryForm` resolves a revision and returns it, and
 * until this record nothing kept it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { asD1Db, type TestDb } from '../helpers/test-db';
import { recordProduction } from '../../../server/services/statutory/production-record';

describe('recordProduction', () => {
    let db: TestDb;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
    });
    afterEach(() => { sqlite.close(); });

    it('records which revision produced a form, so a recall can name the reports', async () => {
        // Without this row, "which reports used the bad map" has no answer at
        // all -- the produce path returns the version and then drops it.
        await recordProduction(asD1Db(db), {
            tenantId: 't1', inspectionId: 'i1', formId: 'tx_trec_rei',
            version: '7-6', sourceHash: 'a'.repeat(64), producedBy: 'u1',
        });
        const rows = await db.select().from(schema.statutoryFormProductions).all();
        expect(rows).toHaveLength(1);
        expect(rows[0].version).toBe('7-6');
        expect(rows[0].tenantId).toBe('t1');
        expect(rows[0].formId).toBe('tx_trec_rei');
        expect(rows[0].sourceHash).toBe('a'.repeat(64));
    });

    it('keeps every production, not just the latest -- a re-issue is a second delivery', async () => {
        const base = {
            tenantId: 't1', inspectionId: 'i1', formId: 'tx_trec_rei',
            sourceHash: 'a'.repeat(64), producedBy: 'u1',
        };
        await recordProduction(asD1Db(db), { ...base, version: '7-6' });
        await recordProduction(asD1Db(db), { ...base, version: '7-6' });
        const rows = await db.select().from(schema.statutoryFormProductions).all();
        // Two deliveries of the same revision are two events. Collapsing them
        // would understate how many documents are in someone else's hands.
        expect(rows).toHaveLength(2);
        expect(new Set(rows.map(r => r.id)).size).toBe(2);
    });
});
