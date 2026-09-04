import type { createApi } from "~/lib/api-client.server";
import type { RevisionStatus } from "../../server/lib/statutory/revision-status";

/**
 * Move one inspection to a new date, and report what that did to its statutory
 * form.
 *
 * ── WHY THE RESPONSE BODY IS READ AT ALL ────────────────────────────────────
 * `PATCH /api/inspections/:id` computes `revisionStatus` on every date change:
 * moving a date can carry an inspection across a mandatory cutover, changing
 * which revision governs it while the template stays where it was, and in the
 * worst case leaving a form that cannot be produced at all. The calendar's
 * action used to answer `{ ok: res.ok }`, so that verdict was calculated on
 * every reschedule and shown to nobody.
 *
 * ── WHY A FAILED PATCH REPORTS NOTHING ──────────────────────────────────────
 * A refused reschedule moved no date, so there is no new revision to describe.
 * Reading the body there would at best relay an error envelope into a banner
 * about statutory revisions.
 *
 * ── WHY AN UNREADABLE BODY IS NOT A FAILURE ─────────────────────────────────
 * The date HAS been written by that point. Throwing on a body that is not JSON
 * would report a failed reschedule for a reschedule that succeeded.
 */
export async function rescheduleInspection(
    api: ReturnType<typeof createApi>,
    { id, date }: { id: string; date: string },
): Promise<{ ok: boolean; revisionStatus: RevisionStatus | null; date: string }> {
    const res = await api.inspections[":id"].$patch({ param: { id }, json: { date } });

    const body = res.ok
        ? await res.json().catch(() => null) as { data?: { revisionStatus?: RevisionStatus } } | null
        : null;

    // The date rides back because every one of the banner's sentences
    // interpolates it; without it they render "dated , which falls under
    // revision X", which is worse than saying nothing.
    return { ok: res.ok, revisionStatus: body?.data?.revisionStatus ?? null, date };
}
