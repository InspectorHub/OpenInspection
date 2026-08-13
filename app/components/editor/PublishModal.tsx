import { Modal, Button, Banner } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import { formatShapedDateTime } from "~/lib/format-date";
import { useSessionContext, useChromeDateTimeFormat, useDisplayTimeZone } from "~/hooks/useSessionContext";

export interface PublishModalProps {
 open: boolean;
 progress: { rated: number; total: number; pct: number };
 status: string;
 publishError: string | null;
 isSubmitting: boolean;
 onClose: () => void;
 /** Publish the report. `markComplete` also closes the order axis first. */
 onPublish: (markComplete: boolean) => void;
 /** Whether to auto-sign the report on publish. */
 autoSign: boolean;
 /** Handler for the auto-sign checkbox. */
 onAutoSignToggle: (checked: boolean) => void;
}

export function PublishModal({ open, progress, status, publishError, isSubmitting, onClose, onPublish, autoSign, onAutoSignToggle }: PublishModalProps) {
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
 return (
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
 onClick={() => onPublish(false)}
 >{isSubmitting ? m.editor_publish_publishing() : m.editor_publish_just_publish()}</Button>
 <Button
 variant="primary"
 disabled={isSubmitting}
 onClick={() => onPublish(true)}
 >{isSubmitting ? m.editor_publish_publishing() : m.editor_publish_mark_complete_and_publish()}</Button>
 </>
 ) : (
 <>
 <Button variant="ghost" onClick={onClose}>{m.common_cancel()}</Button>
 <Button
 variant="primary"
 disabled={isSubmitting}
 onClick={() => onPublish(false)}
 >{isSubmitting ? m.editor_publish_publishing() : m.editor_publish_now()}</Button>
 </>
 )
 }
 >
 <p className="text-[13px] text-ih-fg-3">
 {m.editor_publish_body()}
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
 );
}
