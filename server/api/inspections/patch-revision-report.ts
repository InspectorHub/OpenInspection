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
import type { StatutoryFormVersion } from '../../lib/statutory/form-registry';
import { parseSnapshot } from '../../services/inspection/shared';

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

/**
 * What GET /api/inspections/{id} spreads into its response: the status under its key, or nothing at all
 * (no key, not a null) when the judgement has nothing to say. Same judgement, same absence rule as the reschedule
 * answer above; it reads the snapshot and date the route already loaded, so it adds no query.
 */
export function revisionStatusField(
    inspection: { date?: unknown; templateSnapshot?: unknown },
    now: number = Date.now(),
    versions?: readonly StatutoryFormVersion[],
): { revisionStatus: RevisionStatus } | Record<string, never> {
    const status = revisionStatusForInspection({
        snapshot: parseSnapshot(inspection.templateSnapshot),
        inspectionDate: String(inspection.date ?? '').slice(0, 10),
        now,
        ...(versions === undefined ? {} : { versions }),
    });
    return status === null ? {} : { revisionStatus: status };
}

/**
 * The inspection row with its template snapshot as an object, or null when the stored value is not a readable one.
 *
 * The editor's own saves write the snapshot as a JSON-encoded string into a JSON column, so such a row reads back
 * as a string. Normalised here, on read, so the client sees one shape; the stored value is left as it is.
 */
export function withReadableSnapshot<T extends { templateSnapshot?: unknown }>(inspection: T): Omit<T, 'templateSnapshot'> & { templateSnapshot: { sections: unknown[] } | null } {
    return { ...inspection, templateSnapshot: parseSnapshot(inspection.templateSnapshot) };
}
