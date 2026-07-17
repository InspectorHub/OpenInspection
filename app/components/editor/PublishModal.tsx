import { Modal, Button } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export interface PublishModalProps {
 open: boolean;
 progress: { rated: number; total: number; pct: number };
 status: string;
 publishError: string | null;
 isSubmitting: boolean;
 onClose: () => void;
 onPublish: () => void;
 /** Whether to auto-sign the report on publish. */
 autoSign: boolean;
 /** Handler for the auto-sign checkbox. */
 onAutoSignToggle: (checked: boolean) => void;
}

export function PublishModal({ open, progress, status, publishError, isSubmitting, onClose, onPublish, autoSign, onAutoSignToggle }: PublishModalProps) {
 return (
 <Modal
 open={open}
 onClose={onClose}
 title={m.editor_publish_title()}
 footer={
 <>
 <Button variant="ghost" onClick={onClose}>{m.common_cancel()}</Button>
 <Button
 variant="primary"
 disabled={isSubmitting}
 onClick={onPublish}
 >{isSubmitting ? m.editor_publish_publishing() : m.editor_publish_now()}</Button>
 </>
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
 <div className="mt-4 p-3 rounded-lg bg-ih-bg-muted text-[12px] space-y-1">
 <div className="flex justify-between"><span className="text-ih-fg-3">{m.editor_publish_stat_items_rated()}</span><span className="font-bold">{progress.rated}/{progress.total}</span></div>
 <div className="flex justify-between"><span className="text-ih-fg-3">{m.editor_publish_stat_completion()}</span><span className="font-bold">{progress.pct}%</span></div>
 <div className="flex justify-between"><span className="text-ih-fg-3">{m.editor_publish_stat_status()}</span><span className="font-bold uppercase">{status}</span></div>
 </div>
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
