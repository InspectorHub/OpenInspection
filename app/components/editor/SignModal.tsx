import { Modal } from "@core/shared-ui";
import { SignaturePad } from "../SignaturePad";

export interface SignModalProps {
 open: boolean;
 onSubmit: (dataUri: string) => Promise<void> | void;
 onCancel: () => void;
 failed: boolean;
}

export function SignModal({ open, onSubmit, onCancel, failed }: SignModalProps) {
 return (
 <Modal open={open} onClose={onCancel} title="Inspector Signature">
 <p className="text-[13px] text-ih-fg-3 mb-4">
 Sign this inspection. The signature will be saved and can be included in the published report.
 </p>
 <SignaturePad
 onSubmit={onSubmit}
 onCancel={onCancel}
 label="Save signature"
 />
 {failed && (
 <p className="text-sm text-ih-bad-fg mt-2">Failed to save signature. Please try again.</p>
 )}
 </Modal>
 );
}
