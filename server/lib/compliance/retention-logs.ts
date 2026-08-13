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
import { and, eq, exists, isNotNull, lt, ne, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { SQL } from 'drizzle-orm';
import {
    auditLogs,
    idempotencyKeys,
    parkedCmdEvents,
    processedCmdEvents,
    processedWebhookEvents,
    syncOutbox,
    tenantDestructionRecords,
    aiCallProvenance,
    aiContentReviews,
    reportVersions,
    smsConsentLog,
    smsDisclosureVersions,
    tenantLegalVersions,
    tenantMarketplaceImportHistory,
    tenantSlugHistory,
} from '../db/schema';
import { SYNC_OUTBOX_STATUS } from '../status/sync-outbox-status';
import { DESTRUCTION_STATUS } from '../status/destruction-status';
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

    // TERMINAL rows only. `ne(status, 'pending')` rather than an IN-list of the
    // terminal values on purpose: it also catches the LEGACY `done` rows that
    // `SYNC_OUTBOX_STATUSES` deliberately omits (nothing may write it, but rows
    // holding it exist), which an allow-list would silently leave behind
    // forever. Excluding `pending` is the rule, not an optimization — a pending
    // row is unpublished work the cron sweeper is still retrying, so deleting
    // one destroys an account change portal never saw instead of retiring a
    // record of one.
    sync_outbox: async (rawDb, cutoff) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(syncOutbox)
            .where(and(
                lt(syncOutbox.createdAt, cutoff),
                ne(syncOutbox.status, SYNC_OUTBOX_STATUS.PENDING),
            ))
            .run();
        return changeCount(res);
    },

    // `created_at`, NOT `expires_at`. The latter decides whether a later caller
    // may steal a dead claim and is never consulted once the row is `done`, so
    // a completed row sits past its own expiry indefinitely holding
    // `response_body`. Keying the sweep on it would delete a different set of
    // rows and look exactly as correct. No state predicate: an aged `in_flight`
    // row is a claim whose holder died without unwinding, and removing it is
    // strictly better than leaving it to block the key.
    idempotency_keys: async (rawDb, cutoff) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(idempotencyKeys)
            .where(lt(idempotencyKeys.createdAt, cutoff))
            .run();
        return changeCount(res);
    },

    // Only COMPLETED records expire, and that is the rule rather than an
    // optimization — the same shape as excluding `pending` from `sync_outbox`
    // above. A row still reading `started` is a purge that destroyed a workspace
    // and never said it finished. It is an open anomaly, and the only artifact
    // that says so; sweeping it on age would close the question by destroying
    // the evidence of it, which is the exact failure the two-phase write exists
    // to prevent. Such a row ages out of nothing and waits for a human.
    //
    // `destroyed_at` is the initiation timestamp, not `completed_at`: it is the
    // only one every row has, and a completed record's two timestamps are
    // seconds apart, so the choice moves nothing for the rows that DO expire.
    tenant_destruction_records: async (rawDb, cutoff) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(tenantDestructionRecords)
            .where(and(
                lt(tenantDestructionRecords.destroyedAt, cutoff),
                eq(tenantDestructionRecords.status, DESTRUCTION_STATUS.COMPLETED),
            ))
            .run();
        return changeCount(res);
    },

    // A call a surviving review still cites does NOT expire, and equal windows
    // are why the predicate is needed rather than why it is not: a review is
    // written after the call it cites, so measured from each row's own
    // timestamp the call goes first and leaves the review pointing at nothing.
    // `readAiAssurance` counts exactly that shape as `unresolvedReviewCount` —
    // a health signal for rows written before the ownership check existed. A
    // sweep that manufactured them would turn the alarm into noise.
    ai_call_provenance: async (rawDb, cutoff) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(aiCallProvenance)
            .where(and(
                lt(aiCallProvenance.createdAt, cutoff),
                notExists(
                    db.select({ one: sql`1` }).from(aiContentReviews)
                        .where(eq(aiContentReviews.aiCallId, aiCallProvenance.id)),
                ),
            ))
            .run();
        return changeCount(res);
    },

    ai_content_reviews: async (rawDb, cutoff) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(aiContentReviews)
            .where(lt(aiContentReviews.reviewedAt, cutoff))
            .run();
        return changeCount(res);
    },

    // SUPERSEDED versions only. The highest `version_number` for a report is
    // what the report currently IS — it carries the signature and content hash
    // the verifier reads — so expiring it would not retire history, it would
    // delete the deliverable.
    report_versions: async (rawDb, cutoff) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const newer = db.select({ one: sql`1` }).from(alias(reportVersions, 'rv_newer'))
            .where(and(
                eq(sql`rv_newer.report_id`, reportVersions.reportId),
                sql`rv_newer.version_number > ${reportVersions.versionNumber}`,
            ));
        const res = await db.delete(reportVersions)
            .where(and(lt(reportVersions.createdAt, cutoff), exists(newer)))
            .run();
        return changeCount(res);
    },

    // Two guards, and both are load-bearing. `sms_consent_log` is kept
    // INDEFINITELY by an explicit exemption — the record is the tenant's
    // defence against a consent challenge — and every consent row stamps the
    // disclosure version it was shown. Deleting a cited version would leave
    // permanent evidence pointing at text that no longer exists, which guts the
    // exemption from the other side. The current (highest) version is also kept:
    // it is what the next opt-in will show.
    sms_disclosure_versions: async (rawDb, cutoff) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(smsDisclosureVersions)
            .where(and(
                lt(smsDisclosureVersions.publishedAt, cutoff),
                notExists(
                    db.select({ one: sql`1` }).from(smsConsentLog)
                        .where(eq(smsConsentLog.disclosureVersion, smsDisclosureVersions.version)),
                ),
                exists(
                    db.select({ one: sql`1` }).from(alias(smsDisclosureVersions, 'sdv_newer'))
                        .where(sql`sdv_newer.version > ${smsDisclosureVersions.version}`),
                ),
            ))
            .run();
        return changeCount(res);
    },

    // SUPERSEDED versions only, per (tenant, doc). The newest is the live policy
    // the hosted legal pages render; expiring it would blank them.
    tenant_legal_versions: async (rawDb, cutoff) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const newer = db.select({ one: sql`1` }).from(alias(tenantLegalVersions, 'tlv_newer'))
            .where(and(
                eq(sql`tlv_newer.tenant_id`, tenantLegalVersions.tenantId),
                eq(sql`tlv_newer.doc`, tenantLegalVersions.doc),
                sql`tlv_newer.version > ${tenantLegalVersions.version}`,
            ));
        const res = await db.delete(tenantLegalVersions)
            .where(and(lt(tenantLegalVersions.publishedAt, cutoff), exists(newer)))
            .run();
        return changeCount(res);
    },

    tenant_marketplace_import_history: async (rawDb, cutoff) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(tenantMarketplaceImportHistory)
            .where(lt(tenantMarketplaceImportHistory.createdAt, cutoff))
            .run();
        return changeCount(res);
    },

    // A row whose `retired_until` has not passed is still holding a slug OUT OF
    // CIRCULATION. Deleting one releases the slug early — a different tenant
    // could claim it and inherit every stale link pointing at the old owner.
    // Three years is well past the one-year block, so this predicate should
    // never bind; it is here because "should never" is not "cannot".
    tenant_slug_history: async (rawDb, cutoff) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(tenantSlugHistory)
            .where(and(
                lt(tenantSlugHistory.changedAt, cutoff),
                lt(tenantSlugHistory.retiredUntil, cutoff),
            ))
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
