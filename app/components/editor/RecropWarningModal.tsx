import { Modal, Button } from "@core/shared-ui";

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
 title="Re-crop this photo?"
 size="sm"
 footer={
 <>
 <Button variant="ghost" onClick={onCancel}>Cancel</Button>
 <Button variant="danger" onClick={onConfirm}>Crop &amp; clear</Button>
 </>
 }
 >
 <p className="text-[13px] text-ih-fg-3">
 Re-cropping will remove the existing annotation on this photo (its marks are tied to the previous crop).
 </p>
 </Modal>
 );
}
