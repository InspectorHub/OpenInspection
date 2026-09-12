import { useState } from "react";
import { SegmentedControl, Textarea } from "@core/shared-ui";
import { DEFAULT_REINSPECTION_STATUSES } from "../../../server/lib/reinspection-status";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { m } from "~/paraglide/messages";
import type { FollowupActionResult } from "~/routes/inspection-edit/action-followup.server";

/**
 * #119 — the baseline finding, and the verdict this round exists to record.
 *
 * ── WHAT WAS MISSING ────────────────────────────────────────────────────────
 * A re-inspection carried its data across correctly and showed none of it. The
 * editor opened a carried item on the ORDINARY item panel — rating, notes,
 * canned comments, photos — with no trace of `original` anywhere on the page and
 * no control for `followupStatus`. An inspector standing in front of the chimney
 * could not see that it had been called a Defect last time, and had nowhere to
 * write down whether it had been fixed. `followupStatus` is the only reason a
 * re-inspection exists: the report renders it and the NEXT round's pre-selection
 * is computed from it.
 *
 * ── WHY IT RENDERS ITSELF OFF `result` ──────────────────────────────────────
 * `original` and `followupStatus` are fields of the item's own result entry, so
 * the panel needs no new data: it reads what the item editor was already handed.
 * The WRITE goes through a fetcher to the editor route's `set-followup` intent
 * (see `action-followup.server.ts`) and lands in the same Y.Doc every other
 * field lands in, arriving back here as a broadcast doc update — so the value on
 * screen after a save is the document's, not an optimistic copy of it.
 *
 * ── WHY THE VOCABULARY IS THE DEFAULT SET ───────────────────────────────────
 * Follow-up statuses are per-workspace (`tenant_configs.reinspection_statuses`)
 * and no screen configures them today, so the defaults ARE every workspace's
 * set. The panel offers those; the route checks the submitted key against the
 * workspace's own list and refuses an unknown one by name. So a workspace that
 * acquires a custom set gets a loud refusal here rather than a silently stored
 * key that `isOpenStatus` would read as "still open".
 */

/** Translated label for a default status key; a custom key prints as it came. */
function statusLabel(key: string, fallback: string): string {
  if (key === "resolved") return m.editor_followup_status_resolved();
  if (key === "not_resolved") return m.editor_followup_status_not_resolved();
  if (key === "not_inspected") return m.editor_followup_status_not_inspected();
  return fallback;
}

interface OriginalFinding {
  rating?: string | null;
  notes?: string | null;
  photos?: unknown[];
}

/**
 * Whether this item carries a baseline from the round being re-inspected.
 *
 * Exported so the PARENT decides whether to mount the panel. The panel's own
 * guard cannot do that job: it runs after `useGuardedSubmit`, and hooks run
 * unconditionally — so merely rendering the component demands a data router, and
 * every existing ItemEditor test renders an ordinary item without one.
 */
export function hasCarriedBaseline(result: Record<string, unknown>): boolean {
    return readOriginal(result) !== null;
}

/** Narrow `result.original`; anything that is not an object means "not carried". */
function readOriginal(result: Record<string, unknown>): OriginalFinding | null {
  const raw = result.original;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as OriginalFinding;
}

export function FollowupPanel({
  itemId,
  result,
}: {
  itemId: string | undefined;
  result: Record<string, unknown>;
}) {
  const original = readOriginal(result);
  // #106 - user mutation: records the follow-up verdict on a carried item.
  const { fetcher, submit, busy } = useGuardedSubmit<FollowupActionResult>();
  const savedStatus = typeof result.followupStatus === "string" ? result.followupStatus : "";
  const savedNotes = typeof result.followupNotes === "string" ? result.followupNotes : "";
  // The note is a local draft until blur; the status is not, because a segmented
  // control has no "finished typing" moment to commit on.
  const [noteDraft, setNoteDraft] = useState<string | null>(null);

  // Not a re-inspection item: render nothing at all. An empty "previous round"
  // frame on an ordinary inspection would be a promise of a baseline there is
  // none of.
  if (!original || !itemId) return null;

  // Read once and narrow, rather than through the optional chain twice: the
  // chain does not carry its narrowing into the branch.
  const data = fetcher.data;
  const error = data && data.ok === false ? data.error : undefined;

  function saveStatus(status: string) {
    // No `notes` key — absent means "leave the note alone" (see the action).
    submit({ intent: "set-followup", itemId: itemId as string, status }, { method: "post" });
  }

  function saveNote() {
    if (noteDraft === null || noteDraft === savedNotes) return;
    submit(
      { intent: "set-followup", itemId: itemId as string, status: savedStatus, notes: noteDraft },
      { method: "post" },
    );
  }

  const options = DEFAULT_REINSPECTION_STATUSES.map((s) => ({
    value: s.key,
    label: statusLabel(s.key, s.label),
  }));

  return (
    <section
      data-testid="followup-panel"
      className="rounded-lg border border-ih-border bg-ih-bg-muted p-3 space-y-3"
    >
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
          {m.editor_followup_original_heading()}
        </h4>
        <p className="text-[13px] text-ih-fg-1 mt-1">
          <span className="font-bold">{original.rating || m.editor_followup_original_unrated()}</span>
          {original.notes ? <span className="text-ih-fg-2"> — {original.notes}</span> : null}
        </p>
        {Array.isArray(original.photos) && original.photos.length > 0 && (
          <p className="text-[11px] text-ih-fg-3 mt-0.5">
            {m.editor_followup_original_photos({ count: original.photos.length })}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <h4 className="text-[11px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
          {m.editor_followup_verdict_heading()}
        </h4>
        <SegmentedControl
          options={options}
          value={savedStatus}
          onChange={saveStatus}
          size="md"
          ariaLabel={m.editor_followup_verdict_heading()}
        />
        {savedStatus === "" && (
          <p className="text-[11px] text-ih-watch-fg font-bold">
            {m.editor_followup_verdict_unrecorded()}
          </p>
        )}
        <Textarea
          value={noteDraft ?? savedNotes}
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={saveNote}
          rows={2}
          placeholder={m.editor_followup_notes_placeholder()}
          aria-label={m.editor_followup_notes_placeholder()}
        />
        {busy && <p className="text-[11px] text-ih-fg-3">{m.editor_followup_saving()}</p>}
        {error && <p className="text-[11px] text-ih-bad-fg font-bold">{error}</p>}
      </div>
    </section>
  );
}
