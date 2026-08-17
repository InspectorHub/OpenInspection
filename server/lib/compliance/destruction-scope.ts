/**
 * What a destruction measured, and whether a given record can support today's
 * certification.
 *
 * Two questions that look like one. `status = completed` says the purge
 * finished what it set out to do. Certifiability says the record's measurement
 * universe is as wide as the one a certification would claim, and that every
 * store in it actually reported success. A record written before Durable
 * Objects were purgeable answers yes to the first and no to the second, and
 * that is correct rather than a defect: the old destruction did not fail, it
 * measured less (review).
 *
 * ── Why this is not a third status value ────────────────────────────────────
 * The obvious shape is `status = 'incomplete'`. `destruction-status.ts` has
 * exactly two values on purpose, with the reason written down: a purge cannot
 * report its own failure, because the failures worth recording are the ones
 * that stop it running at all, so ABSENCE of `completed` is the failure signal
 * and it survives a crash in a way a status write never could. A store that
 * refused to purge is a different fact — the run finished, and one measurement
 * came back unverified. Folding it into `status` would make `completed` mean
 * two things again, which is the exact conflation this module exists to end.
 */

import { DESTRUCTION_STATUS } from '../status/destruction-status';

/**
 * Bumped whenever the set of stores a purge REACHES changes.
 *
 * Generation 1: database, object storage and cache — the three the purge swept
 * before Durable Objects had a deletion path at all.
 * Generation 2: adds durable_objects.
 */
export const DESTRUCTION_RECORD_GENERATION = 2;

/**
 * The stores a current-generation destruction measures.
 *
 * Deliberately coarser than `compliance/processing-stores.jsonc`, which lists
 * bindings. This is the certification's vocabulary: a customer asking whether
 * their data is gone does not ask about TENANT_CACHE and OAUTH_KV separately.
 * The registry is where the binding-level detail lives, and the gate there is
 * what keeps the two from drifting into different claims.
 */
export const STORES_MEASURED = [
    'database', 'object_storage', 'cache', 'durable_objects',
] as const;

export interface DestructionScopeView {
    recordVersion: number;
    status: string;
    /** Which stores this destruction attempted. Null on generation-1 rows. */
    storesMeasured: readonly string[] | null;
    /** Per-store outcome, `'complete'` or `'incomplete'`. Null on generation-1 rows. */
    storeResults?: Record<string, string> | null;
}

export function isCertifiableAtCurrentScope(r: DestructionScopeView): boolean {
    // Equality, not `>=`. A record written by a newer deployment measured a
    // universe this code cannot enumerate, so this code is not the one that can
    // judge it — and silently accepting it would let an older certification
    // vouch for a scope it has never heard of.
    if (r.recordVersion !== DESTRUCTION_RECORD_GENERATION) return false;
    if (r.status !== DESTRUCTION_STATUS.COMPLETED) return false;

    const measured = r.storesMeasured ?? [];
    if (!STORES_MEASURED.every((s) => measured.includes(s))) return false;

    // Absence of a result is not a passing result. A row listing four measured
    // stores and reporting on none of them proves nothing, and reading an empty
    // object as "all clear" is how a certification comes to rest on a row
    // nobody wrote.
    const results = r.storeResults ?? {};
    return STORES_MEASURED.every((s) => results[s] === 'complete');
}
