import { Modal, Button } from "@core/shared-ui";

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
 <Button
 variant="ghost"
 onClick={onStay}
 >
 Stay
 </Button>
 <Button
 variant="danger"
 onClick={onLeave}
 >
 Leave
 </Button>
 </>
 }
 >
 <p className="text-[13px] text-ih-fg-3">
 You have unsaved changes. Are you sure you want to leave?
 </p>
 </Modal>
 );
}
