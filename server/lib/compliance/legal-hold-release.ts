/**
 * Ending a preservation order — and giving back the erasures it deferred.
 *
 * `legal_holds` shipped with a release shape (`released_at`, `released_by`,
 * `release_reason`) that nothing wrote. `loadActiveHolds` READ `released_at`,
 * so the schema described a hold that could end while the product contained no
 * path by which one ever did. That is not a missing column assignment; it is a
 * missing half of the mechanism, and the half that was missing is the one the
 * data subject depends on:
 *
 *   1. a subject asks for erasure
 *   2. a hold covers the workspace, so the run is admitted, preserved, logged
 *      `held`, and the subject is told their data was kept
 *   3. the matter closes
 *   4. nothing happens, ever again
 *
 * Step 4 is what this module exists to replace. Data kept ONLY because of an
 * order has to go when the order does, otherwise the erasure right silently
 * degrades into a deferral with no resolution — a worse outcome than a refusal,
 * because a refusal is at least visible to the person who asked.
 *
 * ── Release is the trigger because release is the only event ────────────────
 * There is no signal that a matter has closed other than someone saying so.
 * The re-attempt therefore hangs off the release itself rather than off a
 * timer, which also means it happens at the one moment the operator is present
 * to see the result. `requeueHeldErasures` is nevertheless exported separately
 * and re-checks the hold state itself, so it is safe to call on its own — it is
 * the body a periodic recovery pass would run, for the case where a hold was
 * released by a route that did not come through here.
 *
 * ── What links a hold to the erasures it blocked ────────────────────────────
 * Nothing does, per HOLD — and that is a property of the arbitration rather
 * than an omission in the record. A hold covers a TENANT (`legal-holds.ts`
 * explains why there is no scope column), and `holdDisposition` consumes the
 * UNION of every active hold on that tenant. So an erasure blocked while three
 * orders stood was blocked by all three, and "which hold blocked it" has no
 * answer to store.
 *
 * The linkage that does exist, and is sufficient, is at the tenant level:
 * `erasure_log` keeps `tenant_id`, `subject_email`, `requested_by` and
 * `identity_basis` on the held row. That is exactly enough to re-run the same
 * request, on the same subject, attributed to the same authorising record —
 * which is the whole content of a re-attempt. The predicate for "may it run
 * now" is not "was this particular hold released" but "does any order still
 * cover this workspace", and `loadActiveHolds` already answers that.
 *
 * ── Why the re-run appends instead of amending ──────────────────────────────
 * `erasure_log` is append-only. The re-attempt writes a SECOND row and leaves
 * the `held` one exactly as it was: the preservation genuinely happened, it was
 * the honest answer at the time, and overwriting it would delete the evidence
 * that the workspace was under an order at all. Two rows in time order are the
 * record; one mutated row is a claim that the hold never applied.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { erasureLog, legalHolds, tenantConfigs } from '../db/schema';
import { changeCount } from './db-row-utils';
import { loadActiveHolds } from './legal-hold';
import { runErasure, type ErasureSummary } from './erasure-orchestrator';
import { logger } from '../logger';

/** Same escape hatch as the orchestrator: D1 drizzle in prod, better-sqlite3 in unit tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/**
 * Fallback retention window when a tenant has no `tenant_configs` row.
 * The same number `applySubjectErase` uses — a re-attempt that retained
 * evidence for a different period than the original attempt would be a second
 * policy nobody chose.
 */
const DEFAULT_RETENTION_YEARS = 6;

/**
 * How many deferred subjects one pass will re-attempt.
 *
 * Bounded, and the remainder REPORTED rather than dropped. An unbounded loop
 * over every request a workspace ever deferred is how one release consumes an
 * entire invocation budget and truncates in silence — the failure mode the cron
 * registry's `maxBatch` exists to prevent, applied to the same problem here.
 */
const DEFAULT_MAX_BATCH = 25;

/**
 * The erasure outcome that DEFERS a request, and the ones that END it.
 *
 * Named constants typed against `ErasureSummary['status']` rather than compared
 * as bare strings, and split into two named sets rather than one, because the
 * question this module asks of the outcome vocabulary is not "which value is
 * it" but "does it settle the request". A fifth outcome added to that union
 * fails to compile here until someone answers that for it — which is the whole
 * hazard: a new state whose consumers are not revisited is how an unfinished
 * request comes to be treated as finished.
 *
 * `refused` is in NEITHER set, deliberately. It means the holds table could not
 * be read — a transient fault the command queue retries on its own — so it
 * neither settles a deferral nor is one.
 */
const DEFERRED_STATUS: ErasureSummary['status'] = 'held';
const SETTLING_STATUSES: ReadonlySet<ErasureSummary['status']> =
    new Set<ErasureSummary['status']>(['completed', 'partially_completed']);

/** A subject whose erasure is still waiting on a preservation order. */
export interface HeldErasure {
    /** The `erasure_log` row that recorded the preservation. */
    logId: string;
    subjectEmail: string;
    /** When the request was deferred. Oldest first — a queue, not a set. */
    heldAt: Date;
    /** The authorising record from the original request, carried forward. */
    requestedBy: string | null;
    identityBasis: string | null;
}

/**
 * What one re-attempt produced. `status` is `runErasure`'s, not a restatement.
 *
 * @declarationEmit Exported so the emitted `.d.ts` can NAME it: it appears only
 * inside `RequeueOutcome`, and a composite project cannot reference an
 * unexported alias there (TS4053).
 */
export interface RequeuedErasure {
    subjectEmail: string;
    status: ErasureSummary['status'];
    /** The `erasure_log` row the re-attempt wrote. */
    logId: string;
    deletedCount: number;
    anonymizedCount: number;
}

export interface RequeueOutcome {
    /**
     * True when an order still covers the workspace, so nothing was attempted.
     * Distinct from an empty `requeued`, which also happens when there was
     * simply nothing deferred — a caller must be able to tell "still blocked"
     * from "nothing to do".
     */
    stillHeld: boolean;
    requeued: RequeuedErasure[];
    /** Deferred subjects this pass did not reach. Non-zero means run it again. */
    remaining: number;
}

export interface ReleaseHoldInput {
    holdId: string;
    /** A user id, or a system actor name where an automated path released it. */
    releasedBy: string;
    /** Why it was safe to release. The question a later reader actually asks. */
    releaseReason: string;
}

export interface ReleaseHoldOutcome extends RequeueOutcome {
    /**
     * Whether THIS call performed the release. False when the hold is unknown,
     * and false when it had already been released — in which case the existing
     * release record is left exactly as it was.
     */
    released: boolean;
    /** The workspace the hold covered; null when the hold was not found. */
    tenantId: string | null;
}

/**
 * The subjects whose erasure is still deferred in this workspace.
 *
 * "Still" is the hard part. `erasure_log` is append-only, so a request that was
 * deferred and later satisfied appears TWICE, and a re-queue that could not
 * tell those apart would re-run every request the workspace ever deferred every
 * time any order was released.
 *
 * The rule is per subject and it is about ORDER, not membership: a `held` row
 * is outstanding when no run for the same subject FINISHED after it. A subject
 * can legitimately be completed, then held again under an order placed since —
 * the earlier completion does not settle the later deferral, which is why this
 * is not "has this subject ever been completed".
 *
 * `refused` is deliberately not a settlement and not an outstanding item. It
 * means the holds table could not be read, which is a transient fault the
 * command queue retries on its own; treating it as deferred here would make a
 * hold release the retry mechanism for an unrelated failure, on a workspace
 * whose hold state was never established.
 *
 * ⚠️ Equal timestamps resolve toward re-running. Two rows written in the same
 * millisecond cannot be ordered, and of the two possible mistakes — attempting
 * an erasure that already ran, or leaving one deferred forever — only the
 * second is the defect this module exists to close. The first costs an extra
 * log row against an idempotent run.
 */
export async function findOutstandingHeldErasures(
    rawDb: AnyDb,
    tenantId: string,
): Promise<HeldErasure[]> {
    const db = rawDb as AnyDb;
    const rows = await db.select({
        id: erasureLog.id,
        subjectEmail: erasureLog.subjectEmail,
        status: erasureLog.status,
        requestedBy: erasureLog.requestedBy,
        identityBasis: erasureLog.identityBasis,
        createdAt: erasureLog.createdAt,
    })
        .from(erasureLog)
        .where(eq(erasureLog.tenantId, tenantId))
        .orderBy(asc(erasureLog.createdAt))
        .all();

    type Row = {
        id: string; subjectEmail: string; status: ErasureSummary['status'];
        requestedBy: string | null; identityBasis: string | null; createdAt: Date | number;
    };
    const at = (v: Date | number) => (v instanceof Date ? v.getTime() : Number(v));

    /** The latest DEFERRAL per subject, and the latest SETTLEMENT per subject. */
    const held = new Map<string, { row: Row; ms: number }>();
    const settled = new Map<string, number>();
    for (const r of rows as Row[]) {
        const ms = at(r.createdAt);
        if (r.status === DEFERRED_STATUS) {
            held.set(r.subjectEmail, { row: r, ms });
        } else if (SETTLING_STATUSES.has(r.status)) {
            const prev = settled.get(r.subjectEmail);
            if (prev == null || ms > prev) settled.set(r.subjectEmail, ms);
        }
    }

    const out: HeldErasure[] = [];
    for (const { row, ms } of held.values()) {
        const done = settled.get(row.subjectEmail);
        // Strictly greater: a tie is not evidence the run finished afterwards.
        if (done != null && done > ms) continue;
        out.push({
            logId: row.id,
            subjectEmail: row.subjectEmail,
            heldAt: new Date(ms),
            requestedBy: row.requestedBy,
            identityBasis: row.identityBasis,
        });
    }
    out.sort((a, b) => a.heldAt.getTime() - b.heldAt.getTime());
    return out;
}

/**
 * Re-attempt the erasures this workspace deferred, if it may.
 *
 * Asks `loadActiveHolds` rather than inspecting any particular hold row: that
 * module is the ONLY place that decides what "active" means, and a second
 * opinion here is precisely how the sweep and the erasure came to disagree in
 * the first place. A read failure PROPAGATES — an unreadable holds table looks
 * identical to "no holds" from the outside, and this is the one caller whose
 * response to "no holds" is to start deleting.
 */
export async function requeueHeldErasures(
    rawDb: AnyDb,
    tenantId: string,
    opts: { maxBatch?: number } = {},
): Promise<RequeueOutcome> {
    const db = rawDb as AnyDb;
    const maxBatch = opts.maxBatch ?? DEFAULT_MAX_BATCH;

    const holds = await loadActiveHolds(db);
    if (holds.heldTenantIds.has(tenantId)) {
        // Another order still covers the workspace. Releasing one of several is
        // not the end of the preservation, and the arbiter — not this function —
        // is what says so.
        logger.info('[legal-hold] release did not lift preservation; erasures stay deferred', {
            tenantId, activeHoldCount: holds.activeHoldCount,
        });
        return { stillHeld: true, requeued: [], remaining: 0 };
    }

    const outstanding = await findOutstandingHeldErasures(db, tenantId);
    if (outstanding.length === 0) return { stillHeld: false, requeued: [], remaining: 0 };

    const cfg = await db.select({ years: tenantConfigs.agreementRetentionYears })
        .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
    const retentionYears = cfg?.years ?? DEFAULT_RETENTION_YEARS;

    const batch = outstanding.slice(0, maxBatch);
    const requeued: RequeuedErasure[] = [];
    for (const item of batch) {
        // The original requester travels with the re-attempt. A deletion the
        // record cannot attribute to the request that authorised it reads, a
        // year later, as a deletion nobody asked for.
        const summary = await runErasure(db, {
            tenantId,
            subjectEmail: item.subjectEmail,
            retentionYears,
            ...(item.requestedBy !== null && { requestedBy: item.requestedBy }),
            ...(item.identityBasis !== null && { identityBasis: item.identityBasis }),
        });
        requeued.push({
            subjectEmail: item.subjectEmail,
            status: summary.status,
            logId: summary.logId,
            deletedCount: summary.deletedCount,
            anonymizedCount: summary.anonymizedCount,
        });
    }

    const remaining = outstanding.length - batch.length;
    logger.info('[legal-hold] deferred erasures re-attempted after release', {
        tenantId, requeued: requeued.length, remaining,
    });
    return { stillHeld: false, requeued, remaining };
}

/**
 * End one preservation order, then give back what it deferred.
 *
 * ── The release is guarded on `released_at IS NULL` ─────────────────────────
 * A second release must not overwrite the first. `released_by` and
 * `release_reason` are the record of WHO decided the data no longer had to be
 * kept and on what grounds; re-stamping them with a later caller's name would
 * not be an idempotent no-op, it would replace a true statement with a false
 * one. The guard is in the WHERE clause rather than a read-then-write, so two
 * concurrent releases cannot both believe they won.
 *
 * The re-attempt still runs on the already-released path. It is idempotent and
 * it re-checks the hold state itself, and the outcome this module exists to
 * prevent is an erasure that stays deferred because the one call that would
 * have resolved it declined to look.
 */
export async function releaseHold(
    rawDb: AnyDb,
    input: ReleaseHoldInput,
): Promise<ReleaseHoldOutcome> {
    const db = rawDb as AnyDb;
    const hold = await db.select({ id: legalHolds.id, tenantId: legalHolds.tenantId })
        .from(legalHolds).where(eq(legalHolds.id, input.holdId)).get();

    if (!hold) {
        // Not an error: a caller with a stale id must not be handed a
        // workspace-wide erasure as the consolation prize, so this reports the
        // miss and touches nothing.
        logger.warn('[legal-hold] release requested for an unknown hold', { holdId: input.holdId });
        return { released: false, tenantId: null, stillHeld: false, requeued: [], remaining: 0 };
    }

    const res = await db.update(legalHolds)
        .set({
            releasedAt: new Date(),
            releasedBy: input.releasedBy,
            releaseReason: input.releaseReason,
        })
        .where(and(eq(legalHolds.id, input.holdId), isNull(legalHolds.releasedAt)))
        .run();
    const released = changeCount(res) > 0;

    if (released) {
        logger.info('[legal-hold] released', {
            tenantId: hold.tenantId, holdId: input.holdId, releasedBy: input.releasedBy,
        });
    }

    const requeue = await requeueHeldErasures(db, hold.tenantId);
    return { released, tenantId: hold.tenantId, ...requeue };
}
