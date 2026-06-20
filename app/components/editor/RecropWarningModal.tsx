export interface RecropWarningModalProps {
 onCancel: () => void;
 onConfirm: () => void;
}

export function RecropWarningModal({ onCancel, onConfirm }: RecropWarningModalProps) {
 return (
 <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
 <div className="absolute inset-0 bg-[rgba(15,23,42,0.6)] backdrop-blur-sm" onClick={onCancel} />
 <div className="relative bg-ih-bg-card rounded-lg shadow-ih-popover p-6 max-w-sm w-full border border-ih-border">
 <h3 className="text-[15px] font-bold text-ih-fg-1">Re-crop this photo?</h3>
 <p className="text-[13px] text-ih-fg-3 mt-2">
 Re-cropping will remove the existing annotation on this photo (its marks are tied to the previous crop).
 </p>
 <div className="flex justify-end gap-2 mt-4">
 <button onClick={onCancel} className="px-4 py-2 text-[13px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted rounded-md">Cancel</button>
 <button onClick={onConfirm} className="px-4 py-2 text-[13px] font-bold text-white bg-ih-bad hover:bg-ih-bad/85 rounded-md">Crop &amp; clear</button>
 </div>
 </div>
 </div>
 );
}
