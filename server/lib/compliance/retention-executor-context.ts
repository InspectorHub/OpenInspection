/**
 * What every retention executor is handed, and the one filter they all share.
 *
 * Split out of `retention-executors.ts` so that file and its tenant-less sibling
 * (`retention-executors-platform.ts`) can both import the contract without
 * importing each other. The seam between those two files is the thing this
 * module exists to make expressible: an executor either CAN exclude a held
 * tenant's rows or it cannot, and which one it is has to be visible from the
 * type, not discovered by reading the SQL.
 */
import { notInArray } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { RetentionWindow } from './retention-manifest';
import { subtractMonthsMs } from './db-row-utils';

// Accept either the D1 drizzle type (prod) or the better-sqlite3 test db.
export type AnyDb = DrizzleD1Database<Record<string, unknown>> | { [k: string]: unknown };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What a sweep can reach besides D1.
 *
 * Optional, and its absence is a REFUSAL rather than a degraded mode for any
 * rule that needs it. Every other executor is a `db.delete(...)`; `report_pdfs`
 * points at an object, and deleting the row without the object is worse than
 * doing nothing — the row is the only thing that knows the key.
 */
export interface RetentionSweepStores {
    photos?: R2Bucket | undefined;
}

/**
 * `now` travels beside the cutoff because one rule computes its own cutoffs:
 * `report_pdfs` has a per-tenant window, so a single precomputed date cannot
 * express what it needs.
 */
export interface ExecutorContext {
    now: number;
    stores: RetentionSweepStores;
    /**
     * Tenants under an active legal hold, loaded once for the whole tick by
     * `legal-hold.ts`. Empty on the overwhelmingly common path, and empty means
     * "nothing is held" ONLY because the loader throws rather than returning
     * empty when it cannot read the table. Nothing here may convert a read
     * failure into an empty set.
     */
    heldTenantIds: ReadonlySet<string>;
}

export type Executor = (db: AnyDb, cutoff: Date, ctx: ExecutorContext) => Promise<number>;

/** Cutoff instant for a window: rows strictly OLDER than this are due. */
export function cutoffOf(now: number, window: RetentionWindow): Date {
    return new Date(
        window.unit === 'months'
            ? subtractMonthsMs(now, window.value)
            : now - window.value * DAY_MS,
    );
}

/**
 * "…and this row does not belong to a tenant under legal hold."
 *
 * Returns `undefined` when nothing is held, which drizzle's `and()` drops — so
 * on the ordinary path the generated SQL is byte-identical to what it was
 * before holds existed, and the feature costs a set lookup rather than a
 * `NOT IN ()` on every sweep of every table.
 *
 * Every `tenant_scoped` rule in the manifest must route its tenant column
 * through this. That is not enforced by the type system — an executor that
 * simply forgets compiles and deletes held rows — so it is enforced
 * behaviourally instead: `tests/unit/privacy/legal-hold-sweep.spec.ts` drives a
 * held tenant and an unheld tenant through the real sweep for every
 * `tenant_scoped` table in the manifest, and a rule that forgot this call fails
 * there. A grep-style gate was the alternative and would have passed on an
 * executor that called it against the wrong column.
 */
export function notHeld(column: SQLiteColumn, ctx: ExecutorContext): SQL | undefined {
    if (ctx.heldTenantIds.size === 0) return undefined;
    return notInArray(column, [...ctx.heldTenantIds]);
}
