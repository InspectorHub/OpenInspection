import { Modal, Button } from "@core/shared-ui";

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
 title="Publish Report"
 footer={
 <>
 <Button variant="ghost" onClick={onClose}>Cancel</Button>
 <Button
 variant="primary"
 disabled={isSubmitting}
 onClick={onPublish}
 >{isSubmitting ? "Publishing…" : "Publish Now"}</Button>
 </>
 }
 >
 <p className="text-[13px] text-ih-fg-3">
 Publishing will finalize this inspection and make the report available to clients.
 {progress.pct < 100 && (
 <span className="block mt-2 text-ih-watch font-medium">
 Warning: Only {progress.rated} of {progress.total} items have been rated ({progress.pct}% complete).
 </span>
 )}
 </p>
 <div className="mt-4 p-3 rounded-lg bg-ih-bg-muted text-[12px] space-y-1">
 <div className="flex justify-between"><span className="text-ih-fg-3">Items rated</span><span className="font-bold">{progress.rated}/{progress.total}</span></div>
 <div className="flex justify-between"><span className="text-ih-fg-3">Completion</span><span className="font-bold">{progress.pct}%</span></div>
 <div className="flex justify-between"><span className="text-ih-fg-3">Status</span><span className="font-bold uppercase">{status}</span></div>
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
 Auto-sign this report on publish
 </label>
 </Modal>
 );
}
