/**
 * The bookends around a subject erasure: ask before, record after.
 *
 * These live beside the orchestrator rather than inside it because the
 * orchestrator is the EXECUTOR — a long walk through per-table rules — while
 * these two are the things that must happen whether or not that walk ever
 * starts. Keeping them here is what makes "every exit writes a log row" a
 * property you can check by reading one short file.
 *
 * ── Three states, and this file is where two of them are told apart ─────────
 * A workspace's data can be under three different claims at once:
 *
 *   ordinary lifecycle — a retention window expired, so delete on schedule
 *   preservation order — a matter requires this data to stay
 *   subject erasure    — a person asked for their data to go
 *
 * The scheduled sweep already asked about the middle one. The subject erasure
 * did not, so a preservation order stopped the nightly deletion and did not
 * stop an erasure request — the direction `legal-hold.ts` calls unrecoverable.
 *
 * `holdGate` closes that, and it must close it WITHOUT collapsing the third
 * state into the second. A subject erasure covered by a preservation order is
 * not refused at the door: it is admitted, it runs the arbiter, it is written
 * to the append-only log with its own outcome, and the reason it produces is
 * the sentence the person who asked is entitled to receive. "We preserved your
 * data" and "we never looked" must not leave the same trace.
 */
import { erasureLog } from '../db/schema';
import { holdDisposition, loadActiveHolds } from './legal-hold';
import { logger } from '../logger';
import type { ErasureDecision, ErasureSummary } from './erasure-orchestrator';

/** Same escape hatch as the orchestrator: D1 drizzle in prod, better-sqlite3 in unit tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/** Who the run was for and who authorised it — the same on every exit path. */
export interface ErasureSubject {
    tenantId: string;
    subjectEmail: string;
    requestedBy?: string | undefined;
    identityBasis?: string | undefined;
}

/**
 * Write the single append-only decision-log row and return its id.
 *
 * EVERY exit from an erasure goes through here, including the two that do no
 * work at all. A request that was received and then preserved has to leave the
 * same kind of trace as one that was received and executed — otherwise
 * "a preservation order stopped it" is indistinguishable from "nobody ever
 * asked", and the record that is supposed to justify the answer given to the
 * person does not exist.
 */
export async function writeErasureLog(
    db: AnyDb,
    subject: ErasureSubject,
    status: ErasureSummary['status'],
    decisions: ErasureDecision[],
    counts: { retained: number; anonymized: number; deleted: number },
    responseNote: string | null,
): Promise<string> {
    const id = crypto.randomUUID();
    await db.insert(erasureLog).values({
        id,
        tenantId: subject.tenantId,
        subjectEmail: subject.subjectEmail,
        requestedBy: subject.requestedBy ?? null,
        identityBasis: subject.identityBasis ?? null,
        status,
        decisionsJson: JSON.stringify(decisions),
        retainedCount: counts.retained,
        anonymizedCount: counts.anonymized,
        deletedCount: counts.deleted,
        responseNote,
        createdAt: new Date(),
    });
    return id;
}

const NO_COUNTS = { retained: 0, anonymized: 0, deleted: 0 } as const;

/**
 * Decide whether an erasure may proceed, before it touches anything.
 *
 * Returns `null` when it may — the caller then runs normally. Returns a
 * finished summary when it may not, and that summary is already logged.
 */
export async function holdGate(db: AnyDb, subject: ErasureSubject): Promise<ErasureSummary | null> {
    const { tenantId } = subject;
    let holds;
    try {
        // A hold read that FAILS is not an empty set. `loadActiveHolds` throws
        // for exactly that reason, and converting it here into "no holds" would
        // reintroduce the failure it exists to prevent.
        holds = await loadActiveHolds(db);
    } catch (err) {
        // A sweep that skips a night is recoverable. An erasure that skips a
        // night is a statutory clock still running, so this refuses LOUDLY
        // rather than quietly — the sweep may fail in silence, this may not.
        logger.error(
            '[erasure] refused: the legal-hold table could not be read',
            { tenantId },
            err instanceof Error ? err : undefined,
        );
        const note = 'The legal-hold table could not be read, so nothing was erased.';
        const decisions: ErasureDecision[] = [{
            table: 'legal_holds', action: 'preserve', count: 0,
            error: 'legal holds unreadable',
            holdReason: note,
        }];
        return {
            status: 'refused',
            anonymizedCount: 0, deletedCount: 0, retainedCount: 0, preservedCount: 0,
            decisions,
            logId: await writeErasureLog(db, subject, 'refused', decisions, NO_COUNTS, note),
        };
    }

    const disposition = holdDisposition(tenantId, holds);
    if (disposition.action === 'delete') return null;

    // Nothing runs. Recording one decision per table would imply we looked at
    // each and decided; we did not — the hold answered before any table was
    // consulted, and the record should say that.
    //
    // The request is NOT turned away: it was admitted, it is logged here with
    // its own outcome, and the reason travels with it because that sentence is
    // what the person who asked has to be given.
    logger.info('[erasure] preserved under an active legal hold', {
        tenantId, activeHoldCount: holds.activeHoldCount,
    });
    const decisions: ErasureDecision[] = [{
        table: '*', action: 'preserve', count: 1,
        holdReason: disposition.reason,
    }];
    return {
        status: 'held',
        anonymizedCount: 0, deletedCount: 0, retainedCount: 0,
        preservedCount: 1,
        decisions,
        logId: await writeErasureLog(db, subject, 'held', decisions, NO_COUNTS, disposition.reason),
    };
}
