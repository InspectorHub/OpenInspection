import { Modal, Button } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export interface RecropWarningModalProps {
 open: boolean;
 onCancel: () => void;
 onConfirm: () => void;
}

export function RecropWarningModal({ open, onCancel, onConfirm }: RecropWarningModalProps) {
 return (
 <Modal
 open={open}
 onClose={onCancel}
 title={m.editor_recrop_title()}
 size="sm"
 footer={
 <>
 <Button variant="ghost" onClick={onCancel}>{m.common_cancel()}</Button>
 <Button variant="danger" onClick={onConfirm}>{m.editor_recrop_confirm()}</Button>
 </>
 }
 >
 <p className="text-[13px] text-ih-fg-3">
 {m.editor_recrop_body()}
 </p>
 </Modal>
 );
}
