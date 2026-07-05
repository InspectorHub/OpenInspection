import { Modal } from "@core/shared-ui";

export interface UnsavedChangesBlockerProps {
 open: boolean;
 onStay: () => void;
 onLeave: () => void;
}

/**
 * Confirm-style modal shown while a router navigation is blocked by unsaved
 * changes. Presentation only — the blocking logic lives in the caller (a React
 * Router `useBlocker`); this component just renders the leave/stay choice.
 * Esc/backdrop close maps to the SAFE choice (Stay).
 */
export function UnsavedChangesBlocker({ open, onStay, onLeave }: UnsavedChangesBlockerProps) {
 return (
 <Modal
 open={open}
 onClose={onStay}
 title="Unsaved changes"
 size="sm"
 footer={
 <>
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
 </>
 }
 >
 <p className="text-[13px] text-ih-fg-3">
 You have unsaved changes. Are you sure you want to leave?
 </p>
 </Modal>
 );
}
