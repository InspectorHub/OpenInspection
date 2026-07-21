import { Modal } from "@core/shared-ui";

export function ConfirmDialog({
  open, title, message, confirmLabel = "Delete", tone = "danger", busy = false, onConfirm, onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: "danger" | "default";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmClass =
    tone === "danger"
      ? "bg-ih-bad-fg text-white hover:opacity-90"
      : "bg-ih-primary text-white hover:opacity-90";
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
            className={`px-4 py-2 rounded-md text-[13px] font-bold transition-opacity disabled:opacity-50 ${confirmClass}`}
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
