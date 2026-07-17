import { Modal } from "@core/shared-ui";
import { SignaturePad } from "../SignaturePad";
import { m } from "~/paraglide/messages";

export interface SignModalProps {
 open: boolean;
 onSubmit: (dataUri: string) => Promise<void> | void;
 onCancel: () => void;
 failed: boolean;
}

export function SignModal({ open, onSubmit, onCancel, failed }: SignModalProps) {
 return (
 <Modal open={open} onClose={onCancel} title={m.editor_signmodal_title()}>
 <p className="text-[13px] text-ih-fg-3 mb-4">
 {m.editor_signmodal_body()}
 </p>
 <SignaturePad
 onSubmit={onSubmit}
 onCancel={onCancel}
 label={m.editor_signmodal_save()}
 />
 {failed && (
 <p className="text-sm text-ih-bad-fg mt-2">{m.editor_signmodal_failed()}</p>
 )}
 </Modal>
 );
}
