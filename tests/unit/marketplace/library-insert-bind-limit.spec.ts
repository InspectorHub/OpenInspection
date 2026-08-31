/**
 * A comment-pack import must never bind more parameters than D1 accepts.
 *
 * ── WHY THIS SPEC EXISTS ────────────────────────────────────────────────────
 * `insertLibraryComments` chunked at a hardcoded 18 rows against an eight-column
 * tuple — 144 bound parameters, where D1 accepts 100 — so every comment-pack
 * install failed with `D1_ERROR: too many SQL variables`, in both deployment
 * modes. The comment beside the constant did the arithmetic against a ceiling of
 * 150 that does not exist.
 *
 * Nothing was red, and nothing could have been. The other specs in this
 * directory drive the insert through a better-sqlite3 shim, whose variable limit
 * is in the tens of thousands, so they exercised the statement and could not see
 * the fault. The product-level symptom was reachable only by pressing a button
 * that standalone could not open at all.
 *
 * So this spec asserts against the LIMIT rather than against the outcome: a
 * recording driver that reports how many parameters each statement bound, which
 * is the one thing a permissive SQLite cannot tell us.
 */
import { describe, it, expect } from 'vitest';
import { insertLibraryComments } from '../../../server/services/marketplace/library-insert';

/** D1's documented ceiling. Stated here independently of the source constant —
 *  a test that imported the number it is checking would agree with any value. */
const D1_MAX_BOUND_PARAMS = 100;

const TENANT = '00000000-0000-0000-0000-000000000001';
const LIBRARY = 'lib-1';

/** Records every statement and its bind count; runs nothing. */
function recordingDb() {
    const statements: Array<{ sql: string; params: number }> = [];
    return {
        statements,
        prepare(sql: string) {
            return {
                bind(...params: unknown[]) {
                    statements.push({ sql, params: params.length });
                    return { run: async () => ({}) };
                },
            };
        },
    };
}

function entries(n: number) {
    return Array.from({ length: n }, (_, i) => ({
        text: `Comment ${i}`, section: 'Roof', rating: 'good',
    }));
}

describe('comment-pack insert — D1 bound-parameter ceiling', () => {
    it('binds at most 100 parameters per statement, for a pack the size we ship', async () => {
        // 250 is the size of the Starter Comment Pack this repository ships, so
        // this is the real case rather than a contrived one.
        const db = recordingDb();
        await insertLibraryComments(db, TENANT, LIBRARY, entries(250));

        const worst = Math.max(...db.statements.map((s) => s.params));
        expect(worst, `one statement bound ${worst} parameters`).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
    });

    it('still inserts every row, and in more than one statement', async () => {
        // The two controls for the assertion above, and neither is optional.
        //
        // A chunk size of ZERO — or an early return — binds nothing at all, and
        // `Math.max()` over an empty list is -Infinity, which is comfortably
        // "at most 100". A chunk that silently dropped its tail would also pass.
        // So: the count comes back whole, and the work was genuinely split.
        const db = recordingDb();
        const inserted = await insertLibraryComments(db, TENANT, LIBRARY, entries(250));

        expect(inserted).toBe(250);
        expect(db.statements.length).toBeGreaterThan(1);
    });

    it('binds exactly as many parameters as the statement has placeholders', async () => {
        // The drift this guards is the one that caused the fault: a tuple that
        // grows a column while the chunk divisor keeps the old width. Comparing
        // the two sides of the same statement catches it without either side
        // having to be restated here.
        const db = recordingDb();
        await insertLibraryComments(db, TENANT, LIBRARY, entries(30));

        for (const s of db.statements) {
            expect(s.params).toBe((s.sql.match(/\?/g) ?? []).length);
        }
    });

    it('handles a pack smaller than one chunk without splitting it', async () => {
        // A lower bound on the chunk: an implementation that clamped to one row
        // per statement would satisfy every assertion above and turn a 250-entry
        // pack into 250 round trips.
        const db = recordingDb();
        await insertLibraryComments(db, TENANT, LIBRARY, entries(5));

        expect(db.statements).toHaveLength(1);
        expect(db.statements[0]!.params).toBe(40);
    });
});
