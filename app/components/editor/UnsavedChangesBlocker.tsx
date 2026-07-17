import { Modal, Button } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

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
 title={m.editor_unsavedchanges_title()}
 size="sm"
 footer={
 <>
 <Button
 variant="ghost"
 onClick={onStay}
 >
 {m.editor_unsavedchanges_stay()}
 </Button>
 <Button
 variant="danger"
 onClick={onLeave}
 >
 {m.editor_unsavedchanges_leave()}
 </Button>
 </>
 }
 >
 <p className="text-[13px] text-ih-fg-3">
 {m.editor_unsavedchanges_body()}
 </p>
 </Modal>
 );
}
