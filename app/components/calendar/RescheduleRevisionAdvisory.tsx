import { RevisionBanner } from "~/components/statutory/RevisionBanner";
import type { RevisionStatus } from "../../../server/lib/statutory/revision-status";

/**
 * What a drag-and-drop reschedule just did to the inspection's statutory form.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 * `PATCH /api/inspections/:id` already decides this and returns it as
 * `revisionStatus`; `patch-revision-report.ts` states the reason plainly —
 * moving a date can carry an inspection across a mandatory cutover, and "a
 * daily operation with a hidden consequence is a trap rather than a feature".
 * The calendar's action answered `{ ok }` and dropped the body, so the verdict
 * was computed on every reschedule and rendered nowhere.
 *
 * ── WHY HERE, ABOVE THE GRID ────────────────────────────────────────────────
 * A drag is answered by the grid redrawing and nothing else. There is no dialog
 * to carry this, and a toast would expire while the reader is still looking at
 * where the appointment landed.
 *
 * ── WHY IT IS USUALLY ABSENT ────────────────────────────────────────────────
 * Nearly every inspection produces no statutory form, and the API omits the key
 * rather than sending null in that case. A banner that appeared on every
 * reschedule would be trained away inside a week.
 */
export function RescheduleRevisionAdvisory({ result }: {
    result?: { revisionStatus?: RevisionStatus | null; date?: string };
}) {
    if (!result?.revisionStatus) return null;
    return (
        <div className="mb-4">
            {/* The date rides along because every one of these sentences
                interpolates it; without it they read "dated , which falls
                under revision X". */}
            <RevisionBanner status={result.revisionStatus} inspectionDate={result.date} />
        </div>
    );
}
