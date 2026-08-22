/**
 * The applier behind `cmd.report.correct`.
 *
 * It sits beside `apply-subject-commands.ts` for the same two reasons: the
 * consumer is the PIPELINE (parse → park → dedup → stale guard → apply → reply)
 * and only stays readable while the per-command work lives elsewhere, and a
 * standalone module is exercisable against a real database in the node unit
 * suite, which is where the behaviour that matters can be asserted cheaply.
 *
 * ── This applier's whole job is to keep three endings apart ────────────────
 * Whoever sent the command is holding a request with a statutory clock on it,
 * and will write an answer against it. There are three honest answers and they
 * must not be collapsed:
 *
 *   CARRIED OUT — a reply naming the version published and the version it
 *                 supersedes. The only ending that may be recorded as done.
 *   REFUSED     — a reply carrying `outcome: 'refused'` and the refusal's own
 *                 words, and DELIBERATELY CARRYING NO VERSION NUMBERS. The
 *                 request was answered; the answer is that nothing changed.
 *                 A refusal is final: retrying produces the same refusal.
 *   FAILED      — NO REPLY AT ALL. The error propagates, the queue retries,
 *                 and an exhausted retry becomes a dead command the sender can
 *                 see. This is the same posture `applySubjectErase` takes for a
 *                 partial erasure: a payload the sender can only read as one of
 *                 the two answers above must not be emitted for a run that
 *                 produced neither.
 *
 * The sort is by TYPE — `CorrectionRefusedError` and nothing else. Matching on
 * an error message would start misfiling refusals the day a sentence was
 * reworded, with nothing going red.
 *
 * ── What is NOT reported, and why ──────────────────────────────────────────
 * No list of stored objects rides the reply. The signed PDF, the certificate
 * and the evidence zip do not carry a stamp that a correction updates: each one
 * derives its status from the amendment ledger on every read
 * (`resolveArtifactStatus`). So the amendment IS the fact, and reporting a list
 * of keys alongside it would be inventing a second record of the same thing —
 * one that could go stale, and one that would claim objects exist for an
 * inspection nobody ever produced deliverables for.
 *
 * ── There is no way to ask for a deferral over this seam ───────────────────
 * `correctReport` accepts `deferKeys` so that asking can be REFUSED rather than
 * quietly honoured. The command schema has no such field at all, so the request
 * cannot even be expressed here, and this applier passes nothing. That is the
 * stronger position: the guard remains for direct callers, and the wire carries
 * no way to reach it.
 */
import { correctReport } from '../services/report-correction.service';
import {
    CorrectionRefusedError,
    type CorrectableField,
} from '../lib/validations/correction.schema';
import { logger } from '../lib/logger';

/**
 * What is sent back for `cmd.report.correct`.
 *
 * A UNION, discriminated by `outcome`, for the reason `SubjectErasedReply` is
 * one: the fields a reader needs before recording a completion exist on exactly
 * one branch. A refused correction cannot be mistaken for a carried-out one by
 * a consumer reading the payload, because the payload does not contain the
 * thing a completion is made of.
 *
 * `type`, not `interface` — the consumer's `applyKnownCmd` returns
 * `Record<string, unknown> | undefined`, and only a type alias picks up the
 * implicit index signature that makes this assignable to it.
 */
export type ReportCorrectedReply =
    | {
        /** The correction was carried out. The only outcome that may be recorded as done. */
        outcome: 'corrected';
        inspectionId: string;
        field: CorrectableField;
        /** The amendment that was published. Always >= 2. */
        versionNumber: number;
        /** The version it supersedes — still readable, still verifying. */
        supersedes: number;
    }
    | {
        /**
         * The correction was refused, and would be refused again. Not a
         * failure: the command was received, judged and answered.
         */
        outcome: 'refused';
        inspectionId: string;
        field: CorrectableField;
        /** The refusal in its own words — the sentence a reader is owed. */
        reason: string;
    };

export interface ReportCorrectionCommand {
    tenantId: string;
    inspectionId: string;
    field: CorrectableField;
    to: string;
    reason: string;
}

export async function applyReportCorrection(
    d1: D1Database,
    encryptionSecret: string,
    data: ReportCorrectionCommand,
    opts: { correctedBy?: string | undefined } = {},
): Promise<ReportCorrectedReply> {
    /**
     * The published amendment records WHAT AUTHORISED IT, which arrives as the
     * command's reply handle (`dsar:<requestId>`) — the same handle
     * `applySubjectErase` writes into the erasure log for the same reason.
     *
     * Deliberately NOT an identifier borrowed from the sending system. This
     * column otherwise holds a local user id, and writing a foreign id into it
     * would make every later reader resolve it against the wrong table and find
     * nothing. A prefixed handle cannot be mistaken for one.
     *
     * Its absence is a defect in the SENDER, not an answer for the person the
     * correction is about, so it throws — visibly, into the retry-then-dead
     * path — rather than publishing an amendment nothing can be traced back to.
     */
    if (!opts.correctedBy) {
        throw new Error(
            'report.correct: the command names no authorising record (no replyto). ' +
            'Refusing to publish an amendment that cannot be traced back to the request that asked for it.',
        );
    }

    try {
        const result = await correctReport(d1, encryptionSecret, {
            tenantId: data.tenantId,
            inspectionId: data.inspectionId,
            field: data.field,
            to: data.to,
            reason: data.reason,
            correctedBy: opts.correctedBy,
        });
        logger.info('[cmd] report correction applied', {
            tenantId: data.tenantId,
            inspectionId: data.inspectionId,
            // The field NAME only. The value is the personal data the
            // correction is about and never belongs in a log line.
            field: data.field,
            versionNumber: result.versionNumber,
        });
        return {
            outcome: 'corrected',
            inspectionId: data.inspectionId,
            field: data.field,
            versionNumber: result.versionNumber,
            supersedes: result.supersedes,
        };
    } catch (err) {
        if (!(err instanceof CorrectionRefusedError)) throw err;
        // Logged at info, not error: a refusal is a decision this deployment is
        // entitled to make and is about to be reported as one. Logging it as a
        // failure would put a red mark against every one of them.
        logger.info('[cmd] report correction refused', {
            tenantId: data.tenantId,
            inspectionId: data.inspectionId,
            field: data.field,
            reason: err.message,
        });
        return {
            outcome: 'refused',
            inspectionId: data.inspectionId,
            field: data.field,
            reason: err.message,
        };
    }
}
