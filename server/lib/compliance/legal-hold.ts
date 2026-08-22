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

/**
 * Whether something belonging to this tenant may be deleted right now.
 *
 * ── Why a function and not an `if` at each call site ────────────────────────
 * There are three deletion paths — the scheduled sweep, a subject erasure, and
 * a tenant purge — and the failure this exists to prevent is exactly that they
 * disagreed. They did: the sweep asked about holds and the erasure did not, so
 * a preservation order stopped one and not the other. One function they all ask
 * makes disagreement impossible rather than unlikely.
 *
 * ── This answers ONE of three questions, and must not be read as all three ──
 * Three separate things can be true of a workspace's data at once, and they are
 * arbitrated rather than ranked:
 *
 *   ordinary lifecycle — a retention window expired, so delete on schedule
 *   preservation order — a matter requires this data to stay
 *   subject erasure    — a person asked for their data to go
 *
 * This function answers only the middle one: does an order cover this tenant.
 * It deliberately does NOT decide what the asker should do about that, because
 * the right answer differs by asker. A sweep that is told `preserve` skips the
 * night and owes nobody an explanation. A subject erasure that is told
 * `preserve` still has to be admitted, recorded, and answered — refusing it at
 * the door is as wrong as ignoring the order, and folding the two askers into
 * one boolean here is how that distinction gets lost.
 *
 * ── Why it takes no scope ───────────────────────────────────────────────────
 * A hold covers a tenant. `legal_holds` has no scope column, and its schema
 * header explains that as a decision: a narrow hold must enumerate coverage
 * before anyone knows what the matter will need, and every record it failed to
 * name is deleted on schedule while a hold is nominally in force. This is the
 * seam a narrower rule would land on if one is ever wanted — the signature
 * already takes the tenant rather than a boolean, so adding scope later widens
 * this function instead of rewriting its callers.
 */
export type HoldDisposition =
    | { action: 'delete' }
    | { action: 'preserve'; reason: string };

export function holdDisposition(tenantId: string, holds: ActiveHolds): HoldDisposition {
    if (!holds.heldTenantIds.has(tenantId)) return { action: 'delete' };
    return {
        action: 'preserve',
        reason: 'An active legal hold covers this workspace, so this data is preserved rather than erased.',
    };
}
