/**
 * Shared typed fixture for the ONE type mismatch every `tests/unit/` spec hits.
 *
 * The suite runs business logic against a real in-memory SQLite database
 * (`tests/unit/db.ts` → `drizzle-orm/better-sqlite3`), but the production code
 * it exercises is typed against D1 (`drizzle-orm/d1`). Those two Drizzle
 * instances are structurally identical for everything a service actually calls
 * — `select` / `insert` / `update` / `delete` / `run` / `all` / `get` share one
 * query-builder implementation and one dialect surface. They differ in exactly
 * one member: D1 exposes `batch()` (D1's `db.batch()` transaction primitive),
 * which better-sqlite3 has no analogue for.
 *
 * So the mismatch is real but narrow, and it cannot be typed away from the test
 * side: the callee signatures live under `server/` and correctly say D1. Rather
 * than let ~40 specs each reach for their own `as any` / `as never` at the call
 * site — which is how a genuine shape error hides among the noise — the cast
 * lives here, once, named, with the reason attached.
 *
 * ⚠️ USE ONLY FOR CODE PATHS THAT DO NOT CALL `batch()`. If a service under test
 * starts batching, this fixture will type-check and then fail at runtime with
 * `db.batch is not a function` — that is the honest signal to give that spec a
 * real D1 stub instead of widening this.
 */
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { DrizzleD1Database, drizzle as d1Drizzle } from 'drizzle-orm/d1';
import type { DrizzleDB } from '../../../server/lib/db/scoped';
import type * as schema from '../../../server/lib/db/schema';

/** What `createTestDb()` in `tests/unit/db.ts` hands back. */
export type TestDb = BetterSQLite3Database<typeof schema>;

/**
 * Present a test SQLite database to a `server/` helper typed against D1.
 *
 * The schema generic is a parameter because Drizzle's is INVARIANT: a
 * `DrizzleD1Database<Record<string, never>>` is not assignable to a
 * `DrizzleD1Database<Record<string, unknown>>` and vice versa, so one fixed
 * return type cannot serve both `seedRoleProfiles(db: DrizzleD1Database)` and
 * the `AnyDb = DrizzleD1Database<Record<string, unknown>> | …` unions in
 * `server/services/payment-ledger.service.ts` and `server/lib/compliance/*`.
 * The default matches the bare `DrizzleD1Database`, which is the common case.
 */
export function asD1Db<TSchema extends Record<string, unknown> = Record<string, never>>(
    db: TestDb,
): DrizzleD1Database<TSchema> {
    return db as unknown as DrizzleD1Database<TSchema>;
}

/**
 * Present a test SQLite database to `new ScopedDB(...)`, whose first parameter
 * is `ReturnType<typeof drizzle<typeof schema>>` — the schema-generic form,
 * which is a DIFFERENT type from `asD1Db`'s return (Drizzle's schema generic is
 * invariant, so one helper cannot serve both).
 */
export function asScopedDbSource(db: TestDb): DrizzleDB {
    return db as unknown as DrizzleDB;
}

/**
 * Present a test SQLite database as the return value of a `vi.mock`'d
 * `drizzle-orm/d1` `drizzle()`. Specs that stub that module do so precisely
 * because the code under test builds its own handle from `env.DB`; this is what
 * that handle has to be replaced with.
 */
export function asD1DrizzleReturn(db: TestDb): ReturnType<typeof d1Drizzle> {
    return db as unknown as ReturnType<typeof d1Drizzle>;
}
