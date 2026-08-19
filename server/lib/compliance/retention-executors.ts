/**
 * One executor per manifest table — the statements that actually expire rows.
 *
 * Split out of `retention-logs.ts` when that file crossed the 400-line gate.
 * The seam is the one the code already had: everything here answers "what SQL
 * retires a row of THIS table", and knows nothing about how a sweep is
 * sequenced, how failures are reported, or what a summary looks like;
 * everything left there is the sweep and knows nothing about any table.
 *
 * Keyed by DB table name so the manifest stays the single list of what is
 * governed, and a rule whose table has no executor is a rule that silently does
 * nothing. `retention-logs.spec.ts` asserts the two sets match in BOTH
 * directions: a rule with no executor is a retention promise nothing keeps, and
 * an executor with no rule is a delete statement running on a period nobody
 * wrote down.
 *
 * ── Every table here has a tenant, and every executor uses it ───────────────
 * This file holds the `tenant_scoped` half of the catalogue. Each statement
 * ends with `notHeld(<table>.tenantId, ctx)`, which is how counsel round 33's
 * invariant — a legal hold outranks every scheduled deletion — is actually
 * enforced. The tenant-less rules live in `retention-executors-platform.ts`,
 * where a hold cannot be expressed as a filter and is handled by the driver
 * instead.
 */
import { and, eq, exists, inArray, isNotNull, lt, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import {
    auditLogs,
    idempotencyKeys,
    tenantDestructionRecords,
    aiCallProvenance,
    aiContentReviews,
    reportVersions,
    accountAcceptances,
    notifications,
    qboSyncErrors,
    tenantLegalVersions,
    tenantMarketplaceImportHistory,
    tenantSlugHistory,
    migrationBatches,
    migrationRows,
} from '../db/schema';
import { DESTRUCTION_STATUS } from '../status/destruction-status';
import { ANONYMIZE_AUDIT_PII } from './anonymize-pii';
import { changeCount } from './db-row-utils';
import { notHeld } from './retention-executor-context';
import type { Executor } from './retention-executor-context';
import { PLATFORM_EXECUTORS } from './retention-executors-platform';
import { reportPdfsExecutor } from './retention-report-pdfs';

// Re-exported so `retention-logs.ts` and the specs keep one import site for the
// executor surface; `notHeld` and `ExecutorContext` are deliberately NOT
// re-exported, because the only code that should reach for them is an executor,
// and an executor lives in this file or its platform sibling.
export { cutoffOf } from './retention-executor-context';
export type { AnyDb, Executor, RetentionSweepStores } from './retention-executor-context';

/**
 * The audit-row in-place-erasure SET for the RETENTION clock.
 *
 * The shared `ANONYMIZE_AUDIT_PII` clears the free text and stops there,
 * because on a consumer DSAR `user_id` and `ip_address` are a STAFF actor on a
 * security trail — not the requester's data, and out of scope by an explicit
 * manifest decision.
 *
 * Storage limitation asks a different question. At the two-year mark nobody has
 * requested anything; the basis for holding the identifiers has simply run out,
 * and that applies to the staff actor too. Keeping an IP address on a row
 * labelled as cleared would make the label false — an IP is an identifier,
 * and the manifest's own risk note is that a narrowed erase rule claims a
 * legal outcome it no longer delivers. What survives is the structured event:
 * action, entity_type, entity_id, and the timestamp that made the row due.
 */
const ANONYMIZE_AUDIT_ACTOR = {
    ...ANONYMIZE_AUDIT_PII,
    userId: null,
    ipAddress: null,
} as const;

/**
 * One executor per manifest table.
 *
 * Keyed by DB table name so the manifest stays the single list of what is
 * governed, and a rule whose table has no executor is a rule that silently does
 * nothing — the "rule that exists but never runs" failure. `retention-logs.spec.ts`
 * asserts the two sets match in both directions.
 */
export const EXECUTORS: Record<string, Executor> = {
    ...PLATFORM_EXECUTORS,

    audit_logs: async (rawDb, cutoff, ctx) => {
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
            .where(and(
                lt(auditLogs.createdAt, cutoff),
                stillIdentifying,
                notHeld(auditLogs.tenantId, ctx),
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
    idempotency_keys: async (rawDb, cutoff, ctx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(idempotencyKeys)
            .where(and(
                lt(idempotencyKeys.createdAt, cutoff),
                notHeld(idempotencyKeys.tenantId, ctx),
            ))
            .run();
        return changeCount(res);
    },

    // Only COMPLETED records expire, and that is the rule rather than an
    // optimization — the same shape as excluding `pending` from `sync_outbox`.
    // A row still reading `started` is a purge that destroyed a workspace
    // and never said it finished. It is an open anomaly, and the only artifact
    // that says so; sweeping it on age would close the question by destroying
    // the evidence of it, which is the exact failure the two-phase write exists
    // to prevent. Such a row ages out of nothing and waits for a human.
    //
    // `destroyed_at` is the initiation timestamp, not `completed_at`: it is the
    // only one every row has, and a completed record's two timestamps are
    // seconds apart, so the choice moves nothing for the rows that DO expire.
    tenant_destruction_records: async (rawDb, cutoff, ctx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(tenantDestructionRecords)
            .where(and(
                lt(tenantDestructionRecords.destroyedAt, cutoff),
                eq(tenantDestructionRecords.status, DESTRUCTION_STATUS.COMPLETED),
                notHeld(tenantDestructionRecords.tenantId, ctx),
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
    ai_call_provenance: async (rawDb, cutoff, ctx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(aiCallProvenance)
            .where(and(
                lt(aiCallProvenance.createdAt, cutoff),
                notExists(
                    db.select({ one: sql`1` }).from(aiContentReviews)
                        .where(eq(aiContentReviews.aiCallId, aiCallProvenance.id)),
                ),
                notHeld(aiCallProvenance.tenantId, ctx),
            ))
            .run();
        return changeCount(res);
    },

    ai_content_reviews: async (rawDb, cutoff, ctx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(aiContentReviews)
            .where(and(
                lt(aiContentReviews.reviewedAt, cutoff),
                notHeld(aiContentReviews.tenantId, ctx),
            ))
            .run();
        return changeCount(res);
    },

    // SUPERSEDED versions only. The highest `version_number` for a report is
    // what the report currently IS — it carries the signature and content hash
    // the verifier reads — so expiring it would not retire history, it would
    // delete the deliverable.
    report_versions: async (rawDb, cutoff, ctx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const newer = db.select({ one: sql`1` }).from(alias(reportVersions, 'rv_newer'))
            .where(and(
                eq(sql`rv_newer.report_id`, reportVersions.reportId),
                sql`rv_newer.version_number > ${reportVersions.versionNumber}`,
            ));
        const res = await db.delete(reportVersions)
            .where(and(
                lt(reportVersions.createdAt, cutoff),
                exists(newer),
                notHeld(reportVersions.tenantId, ctx),
            ))
            .run();
        return changeCount(res);
    },

    // SUPERSEDED versions only, per (tenant, doc). The newest is the live policy
    // the hosted legal pages render; expiring it would blank them.
    tenant_legal_versions: async (rawDb, cutoff, ctx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const newer = db.select({ one: sql`1` }).from(alias(tenantLegalVersions, 'tlv_newer'))
            .where(and(
                eq(sql`tlv_newer.tenant_id`, tenantLegalVersions.tenantId),
                eq(sql`tlv_newer.doc`, tenantLegalVersions.doc),
                sql`tlv_newer.version > ${tenantLegalVersions.version}`,
            ));
        // AND not referenced by any surviving acceptance. This check did not exist
        // and did not need to: nothing pointed at these rows until this session
        // added `account_acceptances`, a ledger that is never swept and that
        // stores the version and content hash of the text a person was shown.
        // Without it, an acceptance outlives the text it names — which is the one
        // property the acceptance architecture exists to provide.
        //
        // Counsel round 33 §8 stated the rule: retain while referenced. Note this
        // is NOT "keep forever" — they were explicit that a version nothing cites
        // may still retire. The sibling `sms_disclosure_versions` executor already
        // did exactly this against `sms_consent_log`; this one had simply never
        // been given a referencing table to check.
        const accepted = db.select({ one: sql`1` }).from(accountAcceptances)
            .where(and(
                eq(accountAcceptances.tenantId, tenantLegalVersions.tenantId),
                eq(accountAcceptances.doc, tenantLegalVersions.doc),
                eq(accountAcceptances.version, tenantLegalVersions.version),
            ));
        const res = await db.delete(tenantLegalVersions)
            .where(and(
                lt(tenantLegalVersions.publishedAt, cutoff),
                exists(newer),
                notExists(accepted),
                notHeld(tenantLegalVersions.tenantId, ctx),
            ))
            .run();
        return changeCount(res);
    },

    notifications: async (rawDb, cutoff, ctx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(notifications)
            .where(and(
                lt(notifications.createdAt, cutoff),
                notHeld(notifications.tenantId, ctx),
            ))
            .run();
        return changeCount(res);
    },

    // RESOLVED rows only, and only ones that recorded WHEN. An unresolved error is
    // outstanding work rather than a record of work — the same distinction that
    // keeps `pending` out of the sync_outbox sweep — and a resolved row from before
    // `resolved_at` existed has a NULL anchor, which fails closed rather than being
    // read as "resolved long ago".
    qbo_sync_errors: async (rawDb, cutoff, ctx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(qboSyncErrors)
            .where(and(
                eq(qboSyncErrors.resolved, true),
                isNotNull(qboSyncErrors.resolvedAt),
                lt(qboSyncErrors.resolvedAt, cutoff),
                notHeld(qboSyncErrors.tenantId, ctx),
            ))
            .run();
        return changeCount(res);
    },

    report_pdfs: reportPdfsExecutor,

    tenant_marketplace_import_history: async (rawDb, cutoff, ctx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(tenantMarketplaceImportHistory)
            .where(and(
                lt(tenantMarketplaceImportHistory.createdAt, cutoff),
                notHeld(tenantMarketplaceImportHistory.tenantId, ctx),
            ))
            .run();
        return changeCount(res);
    },

    // A row whose `retired_until` has not passed is still holding a slug OUT OF
    // CIRCULATION. Deleting one releases the slug early — a different tenant
    // could claim it and inherit every stale link pointing at the old owner.
    // Three years is well past the one-year block, so this predicate should
    // never bind; it is here because "should never" is not "cannot".
    tenant_slug_history: async (rawDb, cutoff, ctx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const res = await db.delete(tenantSlugHistory)
            .where(and(
                lt(tenantSlugHistory.changedAt, cutoff),
                lt(tenantSlugHistory.retiredUntil, cutoff),
                notHeld(tenantSlugHistory.tenantId, ctx),
            ))
            .run();
        return changeCount(res);
    },

    /**
     * Intake runs, and the files they were created from.
     *
     * Compares each batch's OWN due date rather than the rule's `cutoff`: one
     * table carries two lifetimes, and which one a batch has is a property of
     * the batch. A row with no due date is left alone — that is a batch nothing
     * has finished writing, not one that has been sitting for ninety days.
     *
     * The bucket is demanded only when a due batch actually has an object, for
     * the same reason as the report-PDF rule: a deployment with nothing expired
     * must not have its whole sweep refused over a binding it never needed.
     *
     * The hold filter is applied on the SELECT, not on the deletes, so the key
     * list is built from the same filtered set. Filtering only the delete would
     * honour a preservation order in D1 and break it in R2, and nothing would
     * report the difference — the row would still be there.
     */
    migration_batches: async (rawDb, _cutoff, ctx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = rawDb as any;
        const due = await db.select({ id: migrationBatches.id, sourceKey: migrationBatches.sourceKey })
            .from(migrationBatches)
            .where(and(
                isNotNull(migrationBatches.expiresAt),
                lt(migrationBatches.expiresAt, new Date(ctx.now)),
                notHeld(migrationBatches.tenantId, ctx),
            ))
            .all();
        if (due.length === 0) return 0;

        const keys = due
            .map((b: { sourceKey: string | null }) => b.sourceKey)
            .filter((k: string | null): k is string => typeof k === 'string' && k.length > 0);

        if (keys.length > 0) {
            const bucket = ctx.stores.photos;
            if (!bucket) {
                throw new Error(
                    'migration_batches retention needs the photos bucket — refusing to delete rows that '
                    + 'point at objects nothing else can reach. Pass { photos } to runLogRetentionSweep.',
                );
            }
            // Objects first. A throw here leaves every row intact.
            await bucket.delete(keys);
        }

        const ids = due.map((b: { id: string }) => b.id);
        await db.delete(migrationRows).where(inArray(migrationRows.batchId, ids)).run();
        const res = await db.delete(migrationBatches).where(inArray(migrationBatches.id, ids)).run();
        return changeCount(res);
    },
};
