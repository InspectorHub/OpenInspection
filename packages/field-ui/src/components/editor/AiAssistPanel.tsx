import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Banner } from "@core/shared-ui";
import { useFieldDataSource } from "../../context";
import type { AiAssistInput, AiAssistResult } from "../../data-source-types";
import { m } from "../../i18n";

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
  /** Called ONLY after the review has been recorded. See `recordReview` below. */
  onAccept: (text: string) => void;
}

/**
 * AI writing assistance for one inspection note, with the human review that has
 * to happen before the text becomes a finding (#61).
 *
 * THE DRAFT NEVER LANDS IN THE NOTE ON ARRIVAL, and that is the design rather
 * than a nicety. It appears BELOW the textarea, in its own slab, while the
 * inspector's own words stay visible above it — the comparison IS the
 * interface. Writing model output straight into the field would make the
 * inspector's text and the model's text indistinguishable a second later; here
 * they are two things until someone says otherwise.
 *
 * ⚠️ THE CONTROL SAYS *REVIEW*, NEVER *ACCEPT*. "The user clicked confirm,
 * therefore the software carries no responsibility" is not a
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
  const ai = useFieldDataSource().resources.aiAssist;
  const [draft, setDraft] = useState<{ text: string; aiCallId: string } | null>(null);
  const [reviewed, setReviewed] = useState(false);
  /** The sentence of the last refused request; any accepted answer clears it. */
  const [error, setError] = useState<string | null>(null);
  // #106 — `assist` spends a metered AI call and `review` writes the record that permits the note to
  // change, so both go out through ONE same-frame guard. The ref is set before the request starts: two
  // clicks in one frame meet it before any render could show `busy`. It is released on every path.
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  // Read at the moment an answer arrives, as the fetcher effect this replaced did: the draft may have
  // moved on, and the parent's accept handler is a fresh closure on every render.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const onAcceptRef = useRef(onAccept);
  onAcceptRef.current = onAccept;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** One guarded request. Resolves to null when the guard dropped it (nothing was sent). */
  async function send(input: AiAssistInput): Promise<AiAssistResult | null> {
    if (inFlight.current || !ai) return null;
    inFlight.current = true;
    setBusy(true);
    try {
      return await ai.run(input);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  // No artifact ⇒ no offer. Rendering the trigger and refusing at the end
  // would waste an AI call on text that could never be recorded as reviewed.
  // No host AI resource ⇒ no offer either: an absent capability hides its entry point.
  if (!resultId || !ai) return null;

  async function improve() {
    const answer = await send({ intent: "assist", payload: { text: notes, context: context ?? "" } });
    // After an unmount nothing is shown, and a dropped call changed nothing.
    if (answer === null || !mounted.current) return;
    if (!answer.ok) {
      setError(answer.error);
      return;
    }
    setError(null);
    if (answer.intent === "assist") {
      // The draft is held here rather than read off the latest answer on every
      // render: the `review` round trip answers with no text in it and would
      // blank the panel mid-decision.
      setDraft({ text: answer.text, aiCallId: answer.aiCallId });
      setReviewed(false);
    }
  }

  async function recordReview() {
    // `resultId` is re-tested here, not only at the early return above: the
    // narrowing on a prop does not reach inside this closure.
    if (!draft || !reviewed || !resultId) return;
    // The review write comes FIRST and the note is changed only below, on its
    // success. Reversing these two steps is the fail-open bug.
    const answer = await send({ intent: "review", payload: { artifactId: resultId, aiCallId: draft.aiCallId } });
    if (answer === null || !mounted.current) return;
    if (!answer.ok) {
      setError(answer.error);
      return;
    }
    setError(null);
    // The review is on file. ONLY NOW does the text become the note.
    const current = draftRef.current;
    if (answer.intent === "review" && current) {
      setDraft(null);
      setReviewed(false);
      onAcceptRef.current(current.text);
    }
  }

  return (
    <div className="mt-1.5">
      {!draft && (
        <div className="flex items-center justify-end">
          <Button
            variant="link"
            size="sm"
            onClick={() => void improve()}
            pending={busy}
            disabled={!notes.trim()}
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
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)} pending={busy}>
              {m.editor_ai_assist_discard()}
            </Button>
            <Button variant="primary" size="sm" onClick={() => void recordReview()} pending={busy} disabled={!reviewed}>
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
