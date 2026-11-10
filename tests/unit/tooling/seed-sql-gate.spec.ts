/**
 * Unit tests for the raw-SQL seeder gate (`scripts/check-seed-sql.mjs`), through
 * its pure detection module `scripts/lib/seed-sql-detect.mjs`.
 *
 * The gate reads the columns named in a raw `INSERT INTO t (...)` or
 * `UPDATE t SET ...` and checks each against the schema. It once read the
 * JavaScript arguments that follow the SQL string as written columns: in
 * `prepare('UPDATE t SET data = ? WHERE tenant_id = ?').bind(x, tenantId)` the
 * closing quote did not end the SET list, so `tenantId` was reported as a column
 * that does not exist. These pin both directions: that statement passes, and a
 * genuinely wrong written column still fails.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

interface Schema { tables: Map<string, Set<string>>; msColumns: Map<string, Set<string>> }
let findSeedSqlViolations: (src: string, filename: string, schema: Schema) => string[];

const SCHEMA: Schema = {
    tables: new Map([
        ['inspection_results', new Set(['id', 'tenant_id', 'inspection_id', 'data', 'updated_at'])],
    ]),
    msColumns: new Map([['inspection_results', new Set(['updated_at'])]]),
};

beforeAll(async () => {
    const modulePath = path.resolve(HERE, '../../../scripts/lib/seed-sql-detect.mjs');
    ({ findSeedSqlViolations } = await import(/* @vite-ignore */ pathToFileURL(modulePath).href));
});

describe('seed-sql gate: UPDATE ... SET column detection', () => {
    it('does not read JS bind arguments after a WHERE clause as written columns', () => {
        const src = `
await b.DB
    .prepare(
        'UPDATE inspection_results SET data = ? WHERE tenant_id = ? AND inspection_id = ?',
    )
    .bind(JSON.stringify(data), tenantId, inspectionId)
    .run();`;
        expect(findSeedSqlViolations(src, 'x.ts', SCHEMA)).toEqual([]);
    });

    it('still fails a SET column that is not in the schema', () => {
        const src = `db.prepare('UPDATE inspection_results SET payload = ? WHERE tenant_id = ?').bind(a, b);`; // seed-lint-ok: a deliberate bad fixture for the gate itself
        const out = findSeedSqlViolations(src, 'x.ts', SCHEMA);
        expect(out).toEqual(['x.ts:1 writes inspection_results.payload, which does not exist in the schema']);
    });

    it('still fails a wrong column that is not the first assignment', () => {
        const src = `db.prepare('UPDATE inspection_results SET data = ?, tenantId = ? WHERE id = ?').bind(a, b, c);`; // seed-lint-ok: a deliberate bad fixture for the gate itself
        const out = findSeedSqlViolations(src, 'x.ts', SCHEMA);
        expect(out).toEqual(['x.ts:1 writes inspection_results.tenantId, which does not exist in the schema']);
    });

    it('does not treat WHERE columns as written, even when they are wrong', () => {
        // The WHERE side is a read; the gate is about WRITES to a column that does not exist.
        const src = `db.prepare('UPDATE inspection_results SET data = ? WHERE nope = ?').bind(a, b);`; // seed-lint-ok: a deliberate bad fixture for the gate itself
        expect(findSeedSqlViolations(src, 'x.ts', SCHEMA)).toEqual([]);
    });

    it('still fails a wrong column after a subquery whose own WHERE sits inside the SET list', () => {
        const src = `db.prepare('UPDATE inspection_results SET data = (SELECT x FROM y WHERE z = ?), nope = ? WHERE id = ?').bind(a, b, c);`; // seed-lint-ok: a deliberate bad fixture for the gate itself
        expect(findSeedSqlViolations(src, 'x.ts', SCHEMA)).toEqual(['x.ts:1 writes inspection_results.nope, which does not exist in the schema']);
    });

    it('still fails a wrong column after a string literal that contains the word WHERE', () => {
        const src = `db.prepare("UPDATE inspection_results SET data = 'WHERE', nope = ? WHERE id = ?").bind(a, b);`; // seed-lint-ok: a deliberate bad fixture for the gate itself
        expect(findSeedSqlViolations(src, 'x.ts', SCHEMA)).toEqual(['x.ts:1 writes inspection_results.nope, which does not exist in the schema']);
    });

    it('does not split a function call into columns', () => {
        const src = `db.prepare("UPDATE inspection_results SET data = json_set(data, '$.k', ?), id = ? WHERE id = ?").bind(a, b, c);`;
        expect(findSeedSqlViolations(src, 'x.ts', SCHEMA)).toEqual([]);
    });

    it('still fails a wrong INSERT column', () => {
        const src = `db.prepare('INSERT INTO inspection_results (id, nope) VALUES (?, ?)').bind(a, b);`; // seed-lint-ok: a deliberate bad fixture for the gate itself
        const out = findSeedSqlViolations(src, 'x.ts', SCHEMA);
        expect(out).toEqual(['x.ts:1 writes inspection_results.nope, which does not exist in the schema']);
    });

    it('still flags seconds written into a timestamp_ms column', () => {
        const src = `const t = Date.now() / 1000;\ndb.prepare('UPDATE inspection_results SET updated_at = ? WHERE id = ?').bind(t, id);`; // seed-lint-ok: a deliberate bad fixture for the gate itself
        const out = findSeedSqlViolations(src, 'x.ts', SCHEMA);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatch(/computes SECONDS/);
    });
});
