import { SignaturePad } from "../SignaturePad";

export interface SignModalProps {
 onSubmit: (dataUri: string) => Promise<void> | void;
 onCancel: () => void;
 failed: boolean;
}

export function SignModal({ onSubmit, onCancel, failed }: SignModalProps) {
 return (
 <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
 <div className="absolute inset-0 bg-[rgba(15,23,42,0.6)] backdrop-blur-sm" onClick={onCancel} />
 <div className="relative bg-ih-bg-card rounded-xl shadow-ih-popover p-6 max-w-md w-full border border-ih-border">
 <h3 className="text-[16px] font-bold text-ih-fg-1">Inspector Signature</h3>
 <p className="text-[13px] text-ih-fg-3 mt-2 mb-4">
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
 </div>
 </div>
 );
}
