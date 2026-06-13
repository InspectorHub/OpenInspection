import { Modal } from "@core/shared-ui";

export function ConfirmDialog({
  open, title, message, confirmLabel = "Delete", busy = false, onConfirm, onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-md border border-ih-border text-[13px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 rounded-md bg-ih-bad-fg text-white text-[13px] font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-[13px] text-ih-fg-2">{message}</p>
    </Modal>
  );
}
