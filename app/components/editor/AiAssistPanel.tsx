import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Banner } from "@core/shared-ui";
import type { AiAssistResult } from "~/routes/resources/ai-assist";
import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";
import { m } from "~/paraglide/messages";

export interface AiAssistPanelProps {
  /** The inspector's current note. Empty ⇒ nothing to improve. */
  notes: string;
  /** Item context sent alongside the note (item label / section title). */
  context?: string;
  /**
   * `inspection_results.id` — the row an `ai_content_reviews` record cites.
   * Null on legacy inspections that have no results row, and the whole panel
   * is then absent: there is no artifact to attach a review to, so there is
   * nothing to offer. See the fail-closed note on the loader.
   */
  resultId: string | null;
  /** Called ONLY after the review has been recorded. See `useReviewed` below. */
  onAccept: (text: string) => void;
}

/**
 * AI writing assistance for one inspection note, with the human review that has
 * to happen before the text becomes a finding (#61).
 *
 * THE DRAFT NEVER LANDS IN THE NOTE ON ARRIVAL, and that is the design rather
 * than a nicety. It appears BELOW the textarea, in its own slab, while the
 * inspector's own words stay visible above it — the comparison IS the
 * interface. Competitors write model output straight into the field, which
 * makes the inspector's text and the model's text indistinguishable a second
 * later; here they are two things until someone says otherwise.
 *
 * ⚠️ THE CONTROL SAYS *REVIEW*, NEVER *ACCEPT*. "The user clicked confirm,
 * therefore the platform is absolved" is not a
 * position this product may take. So the checkbox states a fact the inspector
 * is in a position to state — that they read it — and the row that gets written
 * is `reviewed_by`. Nothing here asks anyone to accept liability, and no label
 * should ever be reworded to imply it did.
 *
 * ⚠️ FAIL CLOSED ON THE REVIEW WRITE. If recording the review fails, the note
 * is NOT changed. The alternative — text in, evidence maybe — is precisely the
 * state this feature exists to end, and it would be invisible: a published
 * report containing model-assisted prose with no record that anyone looked at
 * it. `AiAssistPanel.test.tsx` pins this, because it is the one behaviour here
 * that a reasonable refactor would "simplify" away.
 */
export function AiAssistPanel({ notes, context, resultId, onAccept }: AiAssistPanelProps) {
  // #106 — `assist` spends a metered AI call and `review` writes the record
  // that permits the note to change, so both go out through the guard.
  const { fetcher, submit, busy } = useGuardedSubmit<AiAssistResult>();
  const [draft, setDraft] = useState<{ text: string; aiCallId: string } | null>(null);
  const [reviewed, setReviewed] = useState(false);
  /** The exact response object already acted on, so one round trip is handled
   *  once. `fetcher.data` survives after the request settles, and without this
   *  a later re-render would replay the accept. */
  const handledRef = useRef<AiAssistResult | null>(null);

  const data = fetcher.data;
  const error = data && !data.ok ? data.error : null;

  useEffect(() => {
    if (!data || fetcher.state !== "idle" || handledRef.current === data) return;
    handledRef.current = data;
    if (!data.ok) return;
    if (data.intent === "assist") {
      // The draft is held here rather than read out of `fetcher.data` on every
      // render: the same fetcher then carries the `review` round trip, whose
      // response has no text in it and would blank the panel mid-decision.
      setDraft({ text: data.text, aiCallId: data.aiCallId });
      setReviewed(false);
      return;
    }
    // The review is on file. ONLY NOW does the text become the note.
    if (data.intent === "review" && draft) {
      const accepted = draft.text;
      setDraft(null);
      setReviewed(false);
      onAccept(accepted);
    }
  }, [data, fetcher.state, draft, onAccept]);

  // No artifact ⇒ no offer. Rendering the trigger and refusing at the end
  // would waste an AI call on text that could never be recorded as reviewed.
  if (!resultId) return null;

  function improve() {
    submit(
      { intent: "assist", text: notes, context: context ?? "" },
      { method: "post", action: "/resources/ai-assist" },
    );
  }

  function useReviewed() {
    // `resultId` is re-tested here, not only at the early return above: the
    // guard takes a Record<string, string>, and the narrowing on a prop does
    // not reach inside this closure.
    if (!draft || !reviewed || !resultId) return;
    // The review write comes FIRST and the note is changed only in the branch
    // above, on its success. Reversing these two lines is the fail-open bug.
    submit(
      { intent: "review", artifactId: resultId, aiCallId: draft.aiCallId },
      { method: "post", action: "/resources/ai-assist" },
    );
  }

  return (
    <div className="mt-1.5">
      {!draft && (
        <div className="flex items-center justify-end">
          <Button
            variant="link"
            size="sm"
            onClick={improve}
            disabled={busy || !notes.trim()}
            className="h-auto px-0 py-0 text-[11px]"
          >
            {busy ? m.editor_ai_assist_working() : m.editor_ai_assist_improve()}
          </Button>
        </div>
      )}

      {draft && (
        // The WATCH-toned left rule is deliberate: nothing has gone wrong, but
        // nothing has been decided either. `ih-primary` would read as
        // endorsement and `ih-bad` as an error; watch is "pending judgement",
        // the same register the rating scale uses for Monitor.
        // (There is no `ih-warn` in this design system — a class naming one
        // compiles to nothing and the rule silently disappears.)
        <div className="rounded-lg border border-ih-border-strong border-l-4 border-l-ih-watch bg-ih-bg-app p-3 space-y-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-3">
            {m.editor_ai_assist_draft_eyebrow()}
          </div>
          {/* Same size and face as the note above it, so the inspector reads
              the text it would become rather than a styled quotation. */}
          <p className="text-[13px] leading-relaxed text-ih-fg-1 whitespace-pre-wrap">
            {draft.text}
          </p>
          <div>
            <Checkbox
              label={m.editor_ai_assist_reviewed_label()}
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            <p className="text-[11px] text-ih-fg-3 mt-1 ml-6">
              {m.editor_ai_assist_reviewed_help()}
            </p>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={busy}>
              {m.editor_ai_assist_discard()}
            </Button>
            <Button variant="primary" size="sm" onClick={useReviewed} disabled={busy || !reviewed}>
              {busy ? m.editor_ai_assist_recording() : m.editor_ai_assist_use()}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <Banner tone="warn" className="mt-2 text-[12px] font-medium">
          {/* Two SEPARATE lines, not one run-on. The first is the API's own
              refusal text — `checkAiCapability` writes its denial "for the
              inspector who triggered the call" and this is the first thing
              that has ever shown it to one — and the server does not
              guarantee it ends in a period, so concatenating the second
              sentence after it produced "Internal server error Your note was
              not changed." on the first real click. */}
          <span className="flex flex-col gap-0.5">
            <span>{error}</span>
            {draft && <span>{m.editor_ai_assist_note_unchanged()}</span>}
          </span>
        </Banner>
      )}
    </div>
  );
}
