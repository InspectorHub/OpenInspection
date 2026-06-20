export interface UnsavedChangesBlockerProps {
 onStay: () => void;
 onLeave: () => void;
}

export function UnsavedChangesBlocker({ onStay, onLeave }: UnsavedChangesBlockerProps) {
 return (
 <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
 <div
 className="absolute inset-0 bg-[rgba(15,23,42,0.6)] backdrop-blur-sm"
 onClick={onStay}
 />
 <div className="relative bg-ih-bg-card rounded-lg shadow-ih-popover p-6 max-w-sm w-full">
 <h3 className="text-[15px] font-bold text-ih-fg-1">
 Unsaved changes
 </h3>
 <p className="text-[13px] text-ih-fg-3 mt-2">
 You have unsaved changes. Are you sure you want to leave?
 </p>
 <div className="flex justify-end gap-2 mt-4">
 <button
 onClick={onStay}
 className="px-4 py-2 text-[13px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted rounded-md"
 >
 Stay
 </button>
 <button
 onClick={onLeave}
 className="px-4 py-2 text-[13px] font-bold text-white bg-ih-bad hover:bg-ih-bad/85 rounded-md"
 >
 Leave
 </button>
 </div>
 </div>
 </div>
 );
}
