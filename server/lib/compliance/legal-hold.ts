/**
 * Active legal holds, read once per sweep.
 *
 * review review's global invariant: `legal_hold` overrides every scheduled
 * deletion rule. This module is the only place that decides what "active" means,
 * so no executor can disagree with the driver about whether a tenant is held.
 *
 * ── A failed read is NOT an empty result ────────────────────────────────────
 * `loadActiveHolds` throws rather than returning nothing when it cannot read the
 * table, and the sweep does not catch it. That asymmetry is the whole point: the
 * failure mode this guard exists to prevent is a sweep that could not see the
 * holds and therefore deleted everything under them, and an empty set is exactly
 * what an unreadable table looks like from the outside. A sweep that skips a
 * night is recoverable; a sweep that ran during a preservation order is not.
 *
 * ── Why the set is loaded once, not per rule ────────────────────────────────
 * Eighteen rules run in one tick. Re-reading per rule would let a hold placed
 * mid-sweep apply to some tables and not others, producing a tenant whose data
 * is half preserved — the worst outcome to have to explain. One read at the top
 * makes the whole tick consistent with a single instant.
 */
import { isNull } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { legalHolds } from '../db/schema';

// Accept either the D1 drizzle type (prod) or the better-sqlite3 test db.
type AnyDb = DrizzleD1Database<Record<string, unknown>> | { [k: string]: unknown };

export interface ActiveHolds {
    /**
     * Tenants with at least one hold in force. Rows belonging to these tenants
     * are not eligible for any scheduled deletion.
     *
     * A Set rather than an array because every executor asks the same membership
     * question, and because two holds on one tenant must not make it appear
     * twice in a generated `NOT IN (...)`.
     */
    readonly heldTenantIds: ReadonlySet<string>;
    /**
     * How many hold ROWS are in force — not how many tenants.
     *
     * Reported separately because the two answer different questions: the sweep
     * summary needs "is anything held" (tenants), and the operator reading it
     * needs "how many matters am I preserving for" (rows). Collapsing them would
     * make two holds on one tenant look like one, and releasing the wrong one
     * would then look like it had released both.
     */
    readonly activeHoldCount: number;
}

/**
 * Read every hold that has not been released.
 *
 * Throws on read failure — see the module header. Callers must NOT convert that
 * into an empty result.
 */
export async function loadActiveHolds(rawDb: AnyDb): Promise<ActiveHolds> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = rawDb as any;
    const rows = await db.select({ tenantId: legalHolds.tenantId })
        .from(legalHolds)
        .where(isNull(legalHolds.releasedAt))
        .all();
    const heldTenantIds = new Set<string>();
    for (const r of rows as Array<{ tenantId: string }>) heldTenantIds.add(r.tenantId);
    return { heldTenantIds, activeHoldCount: rows.length };
}
