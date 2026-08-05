import { Modal } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * Both button labels are TRANSLATED, and the confirm label defaults rather than
 * being hardcoded. They used to be the bare strings "Cancel" and "Delete" —
 * which meant this one component silently shipped untranslated chrome to every
 * one of its call sites, in the middle of dialogs whose title and message were
 * translated. A shared component is the worst place to leave a literal: it does
 * not look like ten omissions, it looks like one.
 */
export function ConfirmDialog({
  open, title, message, confirmLabel, tone = "danger", busy = false, onConfirm, onCancel,
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
      : "bg-ih-primary text-ih-fg-inverse hover:opacity-90";
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
            {m.common_cancel()}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-2 rounded-md text-[13px] font-bold transition-opacity disabled:opacity-50 ${confirmClass}`}
          >
            {confirmLabel ?? m.common_delete()}
          </button>
        </>
      }
    >
      <p className="text-[13px] text-ih-fg-2">{message}</p>
    </Modal>
  );
}
