/**
 * OI #276 — the log-retention executor (Track B).
 *
 * The clock for `RETENTION_MANIFEST` (`retention-manifest.ts`), which is where
 * the periods and the reasons for them live. This file only knows HOW to apply
 * one, and deliberately knows nothing about which number applies to what.
 *
 * ── Why this is not in `retention-sweep.ts` ─────────────────────────────────
 * That module is the AGREEMENT clock: per-tenant windows, a `purged_at`
 * destruction marker, a signature to destroy. This one is platform-fixed
 * windows over log tables with no marker column and no tenant dimension. They
 * share a cron tick and nothing else, and merging them would put two different
 * definitions of "due" in one function.
 *
 * There is a second, sharper reason. `erasure-manifest-coverage.spec.ts` reads
 * `retention-sweep.ts` by pinned path and asserts it does not mention
 * `inspections` — the tripwire that keeps the property-address family's
 * "NOT YET ENFORCED" notice honest. Growing that file for unrelated work is how
 * a tripwire ends up widened for a reason that has nothing to do with what it
 * guards. Nothing here references `inspections`, and nothing here should.
 *
 * ── Anonymize reuses the shared SET, and layers on the retention delta ──────
 * `ANONYMIZE_AUDIT_PII` is the same mapping the erasure orchestrator applies,
 * so a row erased then swept and a row swept then erased land byte-identical on
 * the columns both paths touch. The retention path additionally clears the
 * ACTOR columns, which the DSAR path deliberately keeps — see the comment on
 * `ANONYMIZE_AUDIT_ACTOR` below. That delta is layered at this call site rather
 * than pushed into the shared module, exactly as `retention-sweep.ts` layers
 * `signature_base64` on top of the shared signer SET.
 *
 * ── Idempotent, count-only ──────────────────────────────────────────────────
 * Every statement carries a predicate that stops matching once it has run, so a
 * second pass reports zero rather than re-reporting the same work. A cron that
 * logs phantom purges is worse than one that logs nothing, because somebody
 * will eventually chart it. Summaries carry counts and table names only — never
 * a row, never a value.
 */
import { EXECUTORS, type AnyDb, type RetentionSweepStores, cutoffOf } from './retention-executors';
import { loadActiveHolds } from './legal-hold';
import { RETENTION_MANIFEST } from './retention-manifest';

export type { RetentionSweepStores };

/**
 * The tables this module can actually act on.
 *
 * Exported for the drift guard in `tests/unit/privacy/retention-logs.spec.ts`,
 * which asserts it matches `RETENTION_MANIFEST` in BOTH directions: a rule with
 * no executor is a retention promise nothing keeps, and an executor with no
 * rule is a delete statement running on a period nobody wrote down.
 */
export const RETENTION_EXECUTOR_TABLES: readonly string[] = Object.keys(EXECUTORS);

/**
 * Thrown when one or more rules failed, AFTER every other rule has run.
 *
 * Carries the partial summary so a caller can log what did expire — a failure
 * that erases the record of the fourteen tables that worked is a worse report
 * than the one it replaces.
 */
export class RetentionSweepError extends Error {
    constructor(public readonly summary: LogRetentionSummary, public readonly failures: string[]) {
        super(`retention sweep: ${failures.length} rule(s) failed — ${failures.join('; ')}`);
        this.name = 'RetentionSweepError';
    }
}

export interface LogRetentionSummary {
    /** Affected row count per DB table name. Counts only — never row content. */
    perTable: Record<string, number>;
    /** Sum across tables; the one number the cron decides to log on. */
    total: number;
    /**
     * Hold rows in force during this tick, and the tables skipped because of
     * them.
     *
     * Reported rather than silent, because the two ways a sweep returns zero —
     * nothing was due, and everything due was preserved — are the same number
     * with opposite meanings, and only one of them is somebody's cue to ask
     * whether a hold is still needed. `suspendedTables` growing month after
     * month is what an abandoned hold looks like from the outside.
     */
    activeHolds: number;
    suspendedTables: string[];
}

/**
 * Apply every `RETENTION_MANIFEST` rule against `db` at logical time `now`
 * (Unix-MS). One statement per rule — no N+1, matching the existing sweep's
 * shape. Returns per-run counts; a second run at the same instant returns zero.
 *
 * A rule whose table has no executor is SKIPPED rather than thrown on: this
 * runs inside a cron tick, and one mis-keyed rule must not stop the other three
 * from expiring. The spec is what makes that gap loud.
 */
export async function runLogRetentionSweep(
    db: AnyDb,
    now: number,
    stores: RetentionSweepStores = {},
): Promise<LogRetentionSummary> {
    const perTable: Record<string, number> = {};
    let total = 0;

    // ONE read for the whole tick, and deliberately NOT wrapped in the try/catch
    // below. review review made legal hold a global invariant over every
    // scheduled deletion, and the failure that invariant exists to prevent is a
    // sweep that could not see the holds and deleted under them anyway — which
    // is indistinguishable, from in here, from a tick where nothing was held. A
    // sweep that skips a night is recoverable.
    const holds = await loadActiveHolds(db);
    const suspendedTables: string[] = [];

    // Per-rule failures are COLLECTED and rethrown at the end rather than
    // thrown where they happen. A missing bucket must not be able to stop the
    // other fourteen tables from expiring — that would trade one silent gap for
    // fourteen — and it must not be swallowed either, or the sweep reports a
    // clean run while one store keeps everything forever.
    const failures: string[] = [];

    for (const rule of RETENTION_MANIFEST) {
        const exec = EXECUTORS[rule.table];
        if (!exec) continue;
        // `suspend_all` is for the tables with no tenant column: the hold cannot
        // be expressed as a filter, so the whole rule stands down while any hold
        // is in force. The alternative was to run them anyway and hope the held
        // tenant's rows had already aged out, which is a guess wearing the shape
        // of a decision. Recorded in the summary, not skipped quietly.
        if (rule.legalHold === 'suspend_all' && holds.activeHoldCount > 0) {
            suspendedTables.push(rule.table);
            continue;
        }
        try {
            const affected = await exec(db, cutoffOf(now, rule.window), {
                now,
                stores,
                heldTenantIds: holds.heldTenantIds,
            });
            perTable[rule.table] = affected;
            total += affected;
        } catch (err) {
            failures.push(`${rule.table}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    const summary: LogRetentionSummary = {
        perTable,
        total,
        activeHolds: holds.activeHoldCount,
        suspendedTables,
    };
    if (failures.length > 0) {
        throw new RetentionSweepError(summary, failures);
    }

    return summary;
}
