/**
 * A real `D1Database`-SHAPED binding over the in-memory better-sqlite3 fixture.
 *
 * ── Why this exists, and why `asD1Db` is not it ─────────────────────────────
 * `helpers/test-db.ts` hands a `drizzle-orm/better-sqlite3` instance to code
 * typed against `drizzle-orm/d1`. That works for `select`/`insert`/`update`
 * because the two share a query builder, and its own header says it must not be
 * used where the code under test calls `batch()`. This file is the "real D1
 * stub instead of widening this" that header points at.
 *
 * The other shortcut — handing the raw better-sqlite3 `Database` straight in as
 * the BINDING (`sqlite as unknown as D1Database`) and letting production code
 * call `drizzle(binding)` itself — looks more faithful and is worse than either.
 * It half-works, which is the dangerous kind:
 *
 *   - `run()` goes through, because drizzle's D1 driver calls
 *     `stmt.bind(...).run()` and better-sqlite3 happens to have both.
 *   - A SELECT WITH FIELDS does not. Drizzle reaches it through
 *     `stmt.bind(...).raw()`, and better-sqlite3's `.raw()` is a MODE SETTER
 *     that returns the statement — so drizzle reads `rows[0]` off a Statement
 *     object, gets `undefined`, and reports NO ROW FOUND.
 *
 * That produced a spec in which an existing user was invisible to the code that
 * looked it up, so a credential rotation took the INSERT branch and failed on a
 * unique index — an assertion failure that accuses the code under test of a bug
 * the harness invented. A stub that answers "no rows" to every query is the
 * shape of a fixture that can never be trusted to prove an absence.
 *
 * ── What faithfulness means here, and where it stops ────────────────────────
 * `batch()` runs the statements inside a better-sqlite3 TRANSACTION, which
 * mirrors D1's implicit-transaction semantics closely enough to exercise the
 * call path and the rollback direction. It is NOT proof of D1's semantics: this
 * is SQLite in Node, not D1 in workerd, and an invariant that rests on the batch
 * being atomic must be proven in `tests/workers/` against the real binding.
 * See `tests/workers/account-acceptance-atomicity.spec.ts`.
 */
import type { Database as SqliteDatabase } from 'better-sqlite3';

/** What better-sqlite3 accepts as a bound parameter. */
type SqlitePrimitive = string | number | bigint | Buffer | null;

/**
 * Normalize one drizzle-produced parameter for better-sqlite3.
 *
 * D1 accepts booleans, `undefined` and Dates from its callers; better-sqlite3
 * throws `TypeError: SQLite3 can only bind numbers, strings, bigints, buffers,
 * and null`. Drizzle's D1 dialect already converts most of these, so this is a
 * backstop rather than the main path — but a backstop that turns a would-be
 * TypeError into a stored value has to be conservative, so it converts only the
 * three shapes with an unambiguous SQLite representation and lets anything else
 * through to fail loudly.
 */
function toSqliteParam(value: unknown): SqlitePrimitive {
    if (value === undefined || value === null) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value instanceof Date) return value.getTime();
    return value as SqlitePrimitive;
}

interface D1ResultShape {
    success: true;
    results: unknown[];
    meta: Record<string, unknown>;
}

function meta(changes = 0, lastRowId = 0): Record<string, unknown> {
    return {
        duration: 0,
        changes,
        last_row_id: lastRowId,
        changed_db: changes > 0,
        size_after: 0,
        rows_read: 0,
        rows_written: changes,
    };
}

/**
 * One prepared-and-possibly-bound statement.
 *
 * D1's `bind()` returns a NEW statement and leaves the original reusable;
 * better-sqlite3's mutates and refuses a second call. So the binding lives on
 * this wrapper and the underlying statement is prepared fresh per execution —
 * which also sidesteps better-sqlite3's one-mode-per-statement rule for `raw()`.
 */
class StubStatement {
    constructor(
        private readonly sqlite: SqliteDatabase,
        private readonly sql: string,
        private readonly params: SqlitePrimitive[] = [],
    ) {}

    bind(...values: unknown[]): StubStatement {
        return new StubStatement(this.sqlite, this.sql, values.map(toSqliteParam));
    }

    /**
     * Execute synchronously and produce a D1-shaped result.
     *
     * Synchronous on purpose: `batch()` below runs these inside a
     * better-sqlite3 `transaction()`, which rejects a callback that returns a
     * promise. Every async method here is a thin wrapper over this.
     */
    execSync(): D1ResultShape {
        const stmt = this.sqlite.prepare(this.sql);
        if (stmt.reader) {
            return { success: true, results: stmt.all(...this.params) as unknown[], meta: meta() };
        }
        const info = stmt.run(...this.params);
        return { success: true, results: [], meta: meta(info.changes, Number(info.lastInsertRowid)) };
    }

    async run(): Promise<D1ResultShape> {
        return this.execSync();
    }

    async all(): Promise<D1ResultShape> {
        return this.execSync();
    }

    async first(column?: string): Promise<unknown> {
        const stmt = this.sqlite.prepare(this.sql);
        if (!stmt.reader) {
            stmt.run(...this.params);
            return null;
        }
        const row = stmt.get(...this.params) as Record<string, unknown> | undefined;
        if (row === undefined) return null;
        return column === undefined ? row : (row[column] ?? null);
    }

    /** Array-of-arrays, the form drizzle's `values()` (and therefore every
     *  SELECT with fields) reads. Getting this wrong is what made the naive
     *  cast report "no rows" for rows that were there. */
    async raw(): Promise<unknown[][]> {
        const stmt = this.sqlite.prepare(this.sql);
        if (!stmt.reader) {
            stmt.run(...this.params);
            return [];
        }
        return stmt.raw().all(...this.params) as unknown[][];
    }
}

/**
 * Present the in-memory SQLite fixture as a `D1Database` BINDING.
 *
 * Use this (rather than `asD1Db`) when the code under test takes a `D1Database`
 * and builds its own drizzle handle — the production shape — and especially when
 * it calls `db.batch()`.
 */
/**
 * Give a `drizzle-orm/better-sqlite3` instance the ONE method it lacks.
 *
 * For specs that inject their database by mocking `drizzle-orm/d1`'s `drizzle()`
 * rather than by handing production code a binding. The mocked factory returns a
 * better-sqlite3 handle, which is structurally identical for `select`/`insert`/
 * `update`/`delete` and has no `batch()` — so a service that starts batching
 * fails there with `db.batch is not a function`.
 *
 * All-or-nothing via explicit `BEGIN` / `COMMIT` / `ROLLBACK` rather than
 * better-sqlite3's `transaction()` helper: drizzle's statements are thenables,
 * and `transaction()` rejects a callback that returns a promise. On a single
 * connection in a single-threaded spec, awaiting each statement between an
 * explicit BEGIN and COMMIT is the same guarantee.
 *
 * Same caveat as `toD1Binding`: this exercises the batch CALL PATH and the
 * rollback direction. It is not evidence about D1.
 */
export function withBatch<T extends object>(db: T, sqlite: SqliteDatabase): T {
    return Object.assign(db, {
        async batch(statements: PromiseLike<unknown>[]) {
            sqlite.exec('BEGIN');
            try {
                const results: unknown[] = [];
                for (const statement of statements) results.push(await statement);
                sqlite.exec('COMMIT');
                return results;
            } catch (err) {
                sqlite.exec('ROLLBACK');
                throw err;
            }
        },
    });
}

export function toD1Binding(sqlite: SqliteDatabase): D1Database {
    const binding = {
        prepare(sql: string) {
            return new StubStatement(sqlite, sql);
        },
        async batch(statements: StubStatement[]) {
            // All-or-nothing, mirroring D1's implicit transaction. The callback
            // must stay synchronous — better-sqlite3 rejects a promise here,
            // which is why StubStatement carries `execSync`.
            const run = sqlite.transaction((list: StubStatement[]) => list.map((s) => s.execSync()));
            return run(statements);
        },
        async exec(sql: string) {
            sqlite.exec(sql);
            return { count: 0, duration: 0 };
        },
    };
    return binding as unknown as D1Database;
}
