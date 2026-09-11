import { useEffect, useRef, useState } from "react";
import { Modal, Button, Banner, buttonClasses } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import { formatShapedDateTime } from "~/lib/format-date";
import { useSessionContext, useChromeDateTimeFormat, useDisplayTimeZone } from "~/hooks/useSessionContext";

/**
 * The fields the dialog collects that are not the auto-sign flag, as form
 * values ready to ride the publish submission.
 *
 * A named type rather than an inline one because the owning route spreads it
 * into its submit payload, and a payload whose shape only exists at the call
 * site is how a field gets collected and then silently dropped.
 */
export type PublishExtras = Record<string, string>;

export interface PublishModalProps {
 open: boolean;
 progress: { rated: number; total: number; pct: number };
 status: string;
 publishError: string | null;
 isSubmitting: boolean;
 onClose: () => void;
 /**
  * Publish the report. `markComplete` also closes the order axis first, and
  * `extras` carries the fields collected below — the owning route must send them
  * with the publish, not beside it.
  */
 onPublish: (markComplete: boolean, extras: PublishExtras) => void;
 /**
  * Whether the next publish creates version > 1 — i.e. this is a REVISION.
  *
  * Decides whether the dialog asks what changed. The endpoint has accepted a
  * per-publish revision reason all along (`summary`, max 500, stored on the new
  * `report_versions` row and surfaced as the amendment trail's reason and in the
  * amendment email), and this dialog offered no way to type one — so every
  * revision ever published from the editor recorded `null`, and the amendment
  * email's "what changed" line was blank by construction.
  *
  * ── WHY THE NOTIFY FLAGS ARE NOT HERE ───────────────────────────────────────
  * The same endpoint accepts `notifyClient` / `notifyAgent`, and a switch for
  * them looks like the obvious companion to this field. They are deliberately
  * absent: the publish service reads only the report id out of those options, so
  * the flags change nothing about who is told — delivery is decided by the
  * workspace's own report-published automation rules. Offering the switches would
  * ship two controls that do nothing, and worse, the publish audit entry records
  * the flag as given, so a publish marked "do not notify" would read as one that
  * notified nobody while every rule fired as usual. The fix for that is the
  * service, not this dialog.
  */
 isAmendment: boolean;
 /** Whether to auto-sign the report on publish. */
 autoSign: boolean;
 /** Handler for the auto-sign checkbox. */
 onAutoSignToggle: (checked: boolean) => void;
}

export function PublishModal({ open, progress, status, publishError, isSubmitting, onClose, onPublish, autoSign, onAutoSignToggle, isAmendment }: PublishModalProps) {
 // The order lifecycle does not gate publishing (report and order axes are
 // independent). When the on-site work is not yet marked complete, offer an
 // advisory choice — do both, or just publish — but never block.
 const notCompleted = status !== "completed";
 // Portal #98 — the outbound cooling window holds client email for a company's
 // first 24 hours. Said HERE, on the button that sets the expectation, because
 // the account-wide banner answers a different question: it says the window
 // exists, not that THIS publish is about to land in it. Publishing itself is
 // unaffected — the report goes live and the client's email is re-scheduled to
 // the unlock instant, so the wording promises a delay, never a loss.
 //
 // Same `unlockAtMs` the banner reads, so the two cannot name different times;
 // it is non-null only while the window is open, and the server decides that
 // (see resolveCoolingWindowForSession) — no clock arithmetic here.
 const unlockAtMs = useSessionContext()?.outboundCoolingWindow?.unlockAtMs ?? null;
 const timeZone = useDisplayTimeZone();
 const dtFormat = useChromeDateTimeFormat();

 /* ---------------------------------------------------------------- */
 /* The receipt (the publish that told nobody anything)              */
 /* ---------------------------------------------------------------- */
 /**
  * Publishing used to produce NO acknowledgement of any kind: the status pill
  * changed, this dialog vanished, and the Publish button sat there still
  * clickable. The most consequential moment in the product said nothing about
  * what it had done — so an inspector who believed Publish had delivered the
  * report to their client had nothing to correct them.
  *
  * Success is read off the owning route's own contract rather than a new prop:
  * it closes this dialog ONLY when the publish succeeded, and keeps it open with
  * `publishError` set when it did not. So "was submitting, then closed, with no
  * error" is exactly the success signal that route already computes.
  */
 /**
  * The revision reason, for a re-publish. Trimmed and omitted when empty, so a
  * blank box records NULL (the endpoint's own default) instead of an empty
  * string that would render as a reason nobody wrote.
  */
 const [summary, setSummary] = useState("");
 const extras = (): PublishExtras =>
  isAmendment && summary.trim() ? { summary: summary.trim() } : {};
 const [receiptOpen, setReceiptOpen] = useState(false);
 /** Set while a publish is in flight, so a plain Cancel shows no receipt. */
 const submitSeen = useRef(false);
 /**
  * Address of this inspection's detail page, which is where Send report lives.
  *
  * Derived from the editor's own address (`/inspections/:id/edit`) because this
  * dialog is not handed the inspection id, and read inside the effect so nothing
  * touches `window` during SSR. Null when the path is not that shape — the
  * receipt then states the next step rather than offering a button that would go
  * somewhere wrong.
  */
 const [inspectionHref, setInspectionHref] = useState<string | null>(null);
 useEffect(() => {
  if (isSubmitting) submitSeen.current = true;
 }, [isSubmitting]);
 useEffect(() => {
  if (open || !submitSeen.current) return;
  submitSeen.current = false;
  if (publishError) return;
  const path = window.location.pathname;
  setInspectionHref(/\/edit\/?$/.test(path) ? path.replace(/\/edit\/?$/, "") : null);
  // The reason described THIS revision. The dialog stays mounted, so leaving it
  // behind would pre-fill the next revision with the previous one's sentence —
  // visible in the box, but the kind of thing an inspector submits unread.
  setSummary("");
  setReceiptOpen(true);
 }, [open, publishError]);

 return (
 <>
 <Modal
 open={open}
 onClose={onClose}
 title={m.editor_publish_title()}
 footer={
 notCompleted ? (
 <>
 <Button variant="ghost" onClick={onClose}>{m.common_cancel()}</Button>
 <Button
 variant="secondary"
 disabled={isSubmitting}
 onClick={() => onPublish(false, extras())}
 >{isSubmitting ? m.editor_publish_publishing() : m.editor_publish_just_publish()}</Button>
 <Button
 variant="primary"
 disabled={isSubmitting}
 onClick={() => onPublish(true, extras())}
 >{isSubmitting ? m.editor_publish_publishing() : m.editor_publish_mark_complete_and_publish()}</Button>
 </>
 ) : (
 <>
 <Button variant="ghost" onClick={onClose}>{m.common_cancel()}</Button>
 <Button
 variant="primary"
 disabled={isSubmitting}
 onClick={() => onPublish(false, extras())}
 >{isSubmitting ? m.editor_publish_publishing() : m.editor_publish_now()}</Button>
 </>
 )
 }
 >
 <p className="text-[13px] text-ih-fg-3">
 {/* WHAT PUBLISHING ACTUALLY DOES. This used to read "Publishing will
     finalize this inspection and make the report available to clients",
     which names a delivery that does not happen here: publishing flips the
     report to published, writes a version row and FIRES THE AUTOMATIONS —
     which enqueue `automation_logs` rows the five-minute `automation-flush`
     cron delivers later. No link is minted and no mail leaves the building
     in this request, so an inspector who read that sentence and stopped had
     a client with nothing. Both sentences are needed: the first says what
     was achieved, the second says what was not. */}
 {m.report_publish_body_finalize()}{" "}
 <span className="block mt-2">{m.report_publish_body_delivery()}</span>
 {progress.pct < 100 && (
 <span className="block mt-2 text-ih-watch font-medium">
 {m.editor_publish_warning({ rated: progress.rated, total: progress.total, pct: progress.pct })}
 </span>
 )}
 </p>
 {/* No weight class here, and that is not an oversight: Banner hardcodes
  `font-semibold` in its base, so a `font-medium` passed through
  `className` loses the tie on stylesheet order and silently does
  nothing — while `text-[12px]` on the same string DOES win, because
  Tailwind v4 sorts arbitrary values after the named scale. One
  override landing and the other not, from one attribute, is not
  something a reader can see. The notice is kept SHORT instead, so
  semibold does not out-shout the rating warning above it. */}
 {unlockAtMs !== null && (
 <Banner tone="info" className="mt-3 text-[12px]">
 {m.editor_publish_cooling_notice({
 unlockAt: formatShapedDateTime(unlockAtMs, timeZone, dtFormat),
 })}
 </Banner>
 )}
 <div className="mt-4 p-3 rounded-lg bg-ih-bg-muted text-[12px] space-y-1">
 <div className="flex justify-between"><span className="text-ih-fg-3">{m.editor_publish_stat_items_rated()}</span><span className="font-bold">{progress.rated}/{progress.total}</span></div>
 <div className="flex justify-between"><span className="text-ih-fg-3">{m.editor_publish_stat_completion()}</span><span className="font-bold">{progress.pct}%</span></div>
 <div className="flex justify-between"><span className="text-ih-fg-3">{m.editor_publish_stat_status()}</span><span className="font-bold uppercase">{status}</span></div>
 </div>
 {notCompleted && (
 <p className="mt-3 text-[12px] text-ih-fg-3">
 {m.editor_publish_not_completed_prompt()}
 </p>
 )}
 {publishError && (
 <div role="alert" className="mt-4 p-3 rounded-lg bg-ih-bad/10 border border-ih-bad/30 text-[12px] text-ih-bad font-medium">
 {publishError}
 </div>
 )}
 {isAmendment && (
 <label className="mt-4 block">
 {/* The hub's own publish dialog asks this in these exact words; reusing its
     keys is what keeps the two from asking differently-worded versions of one
     question about the same row. */}
 <span className="block text-[12px] font-medium text-ih-fg-2 mb-1">
 {m.inspections_hub_publish_summary_label()}
 </span>
 <textarea
  value={summary}
  onChange={(e) => setSummary(e.target.value)}
  rows={3}
  maxLength={500}
  placeholder={m.inspections_hub_publish_summary_ph()}
  className="w-full rounded-lg border border-ih-border bg-ih-bg-card px-2.5 py-1.5 text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4 focus:border-ih-primary focus:ring-1 focus:ring-ih-primary"
 />
 </label>
 )}
 <label className="mt-4 inline-flex items-center gap-2 text-[12px] font-medium text-ih-fg-3 cursor-pointer select-none">
 <input
  type="checkbox"
  checked={autoSign}
  onChange={(e) => onAutoSignToggle(e.target.checked)}
  className="h-3.5 w-3.5 rounded border-ih-border-strong text-ih-primary"
 />
 {m.editor_publish_autosign()}
 </label>
 </Modal>
 <Modal
 open={receiptOpen}
 onClose={() => setReceiptOpen(false)}
 title={m.report_publish_receipt_title()}
 footer={
  <>
  <Button variant="ghost" onClick={() => setReceiptOpen(false)}>{m.common_close()}</Button>
  {inspectionHref && (
   /* A real anchor, not a Button with an onClick: the next step is a
      navigation, and it should middle-click and open in a new tab like
      every other link (see buttonClasses in shared-ui). */
   <a className={buttonClasses({ variant: "primary", size: "md" })} href={inspectionHref}>
   {m.report_publish_receipt_goto()}
   </a>
  )}
  </>
 }
 >
 <p className="text-[13px] text-ih-fg-2">{m.report_publish_receipt_nothing_sent()}</p>
 {/* The SAME sentence the dialog showed BEFORE publishing. The promise and the
     receipt have to agree word for word, or one of the two is where the reader
     learns something new at the wrong moment. */}
 <p className="mt-2 text-[13px] text-ih-fg-3">{m.report_publish_body_delivery()}</p>
 </Modal>
 </>
 );
}
