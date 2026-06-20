export interface AddMediaChooserProps {
 onClose: () => void;
 onPickPhoto: () => void;
 onPickVideo: () => void;
}

export function AddMediaChooser({ onClose, onPickPhoto, onPickVideo }: AddMediaChooserProps) {
 return (
 <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Add media">
  <button
   type="button"
   aria-label="Close"
   className="absolute inset-0 bg-[rgba(15,23,42,0.4)]"
   onClick={onClose}
  />
  <div className="relative w-full max-w-md rounded-t-2xl bg-ih-bg-card p-4 shadow-ih-popover">
   <h2 className="mb-3 text-[15px] font-bold text-ih-fg-1">Add media</h2>
   <div className="grid grid-cols-2 gap-3">
    <button
     type="button"
     onClick={onPickPhoto}
     className="min-h-[44px] rounded-xl border border-ih-border bg-ih-bg-muted px-4 py-3 text-[14px] font-bold text-ih-fg-1 hover:border-ih-primary"
    >
     Photo
    </button>
    {(() => {
     const offline = typeof navigator !== "undefined" && navigator.onLine === false;
     return (
      <button
       type="button"
       disabled={offline}
       onClick={onPickVideo}
       title={offline ? "Video upload requires a connection" : undefined}
       className="min-h-[44px] rounded-xl border border-ih-border bg-ih-bg-muted px-4 py-3 text-[14px] font-bold text-ih-fg-1 hover:border-ih-primary disabled:opacity-40"
      >
       Video
       {offline && <span className="mt-1 block text-[10px] font-normal text-ih-fg-4">Requires a connection</span>}
      </button>
     );
    })()}
   </div>
  </div>
 </div>
 );
}
