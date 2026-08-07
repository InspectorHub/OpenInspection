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
 * `signature_base64` on top of the shared agreement SET.
 *
 * ── Idempotent, count-only ──────────────────────────────────────────────────
 * Every statement carries a predicate that stops matching once it has run, so a
 * second pass reports zero rather than re-reporting the same work. A cron that
 * logs phantom purges is worse than one that logs nothing, because somebody
 * will eventually chart it. Summaries carry counts and table names only — never
 * a row, never a value.
 */
import { and, isNotNull, lt, or } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { SQL } from 'drizzle-orm';
import {
    auditLogs,
    parkedCmdEvents,
    processedCmdEvents,
    processedWebhookEvents,
} from '../db/schema';
import { ANONYMIZE_AUDIT_PII } from './anonymize-pii';
import { changeCount, subtractMonthsMs } from './db-row-utils';
import { RETENTION_MANIFEST, type RetentionWindow } from './retention-manifest';

// Accept either the D1 drizzle type (prod) or the better-sqlite3 test db.
type AnyDb = DrizzleD1Database<Record<string, unknown>> | { [k: string]: unknown };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The audit-row anonymize SET for the RETENTION clock.
 *
 * The shared `ANONYMIZE_AUDIT_PII` clears the free text and stops there,
 * because on a consumer DSAR `user_id` and `ip_address` are a STAFF actor on a
 * security trail — not the requester's data, and out of scope by an explicit
 * manifest decision.
 *
 * Storage limitation asks a different question. At the two-year mark nobody has
 * requested anything; the basis for holding the identifiers has simply run out,
 * and that applies to the staff actor too. Keeping an IP address on a row
 * labelled "anonymized" would make the label false — an IP is an identifier,
 * and the manifest's own risk note is that a narrowed anonymize rule claims a
 * legal outcome it no longer delivers. What survives is the structured event:
 * action, entity_type, entity_id, and the timestamp that made the row due.
 */
const ANONYMIZE_AUDIT_ACTOR = {
    ...ANONYMIZE_AUDIT_PII,
    userId: null,
    ipAddress: null,
} as const;

/** Cutoff instant for a window: rows strictly OLDER than this are due. */
function cutoffOf(now: number, window: RetentionWindow): Date {
    return new Date(
        window.unit === 'months'
            ? subtractMonthsMs(now, window.value)
            : now - window.value * DAY_MS,
    );
}

/**
 * One executor per manifest table.
 *
 * Keyed by DB table name so the manifest stays the single list of what is
 * governed, and a rule whose table has no executor is a rule that silently does
 * nothing — the "rule that exists but never runs" failure. `retention-logs.spec.ts`
 * asserts the two sets match in both directions.
 */
type Executor = (db: AnyDb, cutoff: Date) => Promise<number>;

const EXECUTORS: Record<string, Executor> = {
    audit_logs: async (rawDb, cutoff) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        // The `isNotNull` disjunction is the idempotency guard: once a row's
        // actor and metadata are cleared it no longer matches, so a re-run
        // reports 0 instead of re-counting rows it did not change.
        const stillIdentifying: SQL | undefined = or(
            isNotNull(auditLogs.userId),
            isNotNull(auditLogs.ipAddress),
            isNotNull(auditLogs.metadata),
        );
        const res = await db.update(auditLogs)
            .set(ANONYMIZE_AUDIT_ACTOR)
            .where(and(lt(auditLogs.createdAt, cutoff), stillIdentifying))
            .run();
        return changeCount(res);
    },

    processed_webhook_events: async (rawDb, cutoff) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(processedWebhookEvents)
            .where(lt(processedWebhookEvents.receivedAt, cutoff))
            .run();
        return changeCount(res);
    },

    // `processed_at`, NOT `received_at`. The two dedup ledgers were written
    // months apart and never converged on a column name; a rule pointed at the
    // wrong one matches nothing and reads exactly like a rule that works.
    processed_cmd_events: async (rawDb, cutoff) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(processedCmdEvents)
            .where(lt(processedCmdEvents.processedAt, cutoff))
            .run();
        return changeCount(res);
    },

    parked_cmd_events: async (rawDb, cutoff) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(parkedCmdEvents)
            .where(lt(parkedCmdEvents.receivedAt, cutoff))
            .run();
        return changeCount(res);
    },
};

/**
 * The tables this module can actually act on.
 *
 * Exported for the drift guard in `tests/unit/privacy/retention-logs.spec.ts`,
 * which asserts it matches `RETENTION_MANIFEST` in BOTH directions: a rule with
 * no executor is a retention promise nothing keeps, and an executor with no
 * rule is a delete statement running on a period nobody wrote down.
 */
export const RETENTION_EXECUTOR_TABLES: readonly string[] = Object.keys(EXECUTORS);

export interface LogRetentionSummary {
    /** Affected row count per DB table name. Counts only — never row content. */
    perTable: Record<string, number>;
    /** Sum across tables; the one number the cron decides to log on. */
    total: number;
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
): Promise<LogRetentionSummary> {
    const perTable: Record<string, number> = {};
    let total = 0;

    for (const rule of RETENTION_MANIFEST) {
        const exec = EXECUTORS[rule.table];
        if (!exec) continue;
        const affected = await exec(db, cutoffOf(now, rule.window));
        perTable[rule.table] = affected;
        total += affected;
    }

    return { perTable, total };
}
