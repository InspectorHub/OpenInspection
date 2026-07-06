import { Modal } from "@core/shared-ui";

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
 <button onClick={onCancel} className="px-4 py-2 text-[13px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted rounded-md">Cancel</button>
 <button onClick={onConfirm} className="px-4 py-2 text-[13px] font-bold text-white bg-ih-bad hover:bg-ih-bad/85 rounded-md">Crop &amp; clear</button>
 </>
 }
 >
 <p className="text-[13px] text-ih-fg-3">
 Re-cropping will remove the existing annotation on this photo (its marks are tied to the previous crop).
 </p>
 </Modal>
 );
}
