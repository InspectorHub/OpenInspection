/**
 * What a PATCH of an inspection reports about the statutory revision governing
 * it.
 *
 * ── WHY A RESCHEDULE CANNOT BE SILENT ───────────────────────────────────────
 * Moving an inspection's date can carry it across a mandatory cutover, which
 * changes the revision that governs it while the template stays exactly where
 * it was. The change stays ALLOWED -- a client asking for another morning is
 * the client's business and this endpoint is not the place to refuse it. What
 * it must not be is quiet, because rescheduling is a daily operation and a
 * daily operation with a hidden consequence is a trap rather than a feature.
 *
 * ── ONE ANSWER, NOT A SECOND OPINION ────────────────────────────────────────
 * The judgement is `revisionStatusForInspection`, the same call the editor
 * banner and the update confirmation make. Nothing is re-derived here.
 *
 * ── ABSENT MEANS "NOTHING TO SAY", NEVER "NOBODY LOOKED" ────────────────────
 * The key is omitted rather than sent as null for an inspection that produces
 * no statutory form -- which is nearly all of them -- and for a patch that did
 * not touch the date at all.
 */
import { revisionStatusForInspection, type RevisionStatus } from '../../lib/statutory/revision-status';

export interface PatchInspectionResult {
    success: true;
    data?: { revisionStatus: RevisionStatus };
}

export function patchRevisionReport(
    /** The validated patch body, to see whether the date was in it at all. */
    body: { date?: unknown },
    /** The values actually written, whose `date` may carry a preserved time suffix. */
    written: Record<string, unknown>,
    /** The row as it was BEFORE the patch -- the snapshot does not change here. */
    before: { date?: unknown; templateSnapshot?: unknown },
): PatchInspectionResult {
    if (typeof body.date !== 'string') return { success: true };

    const status = revisionStatusForInspection({
        snapshot: before.templateSnapshot,
        inspectionDate: String(written.date ?? before.date ?? '').slice(0, 10),
        now: Date.now(),
    });
    return status === null ? { success: true } : { success: true, data: { revisionStatus: status } };
}
