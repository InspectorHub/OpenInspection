import { useRef } from "react";
import { Modal, Button } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * D8 — "Add section" title prompt modal.
 *
 * Presentation rides the shared Modal primitive (scrim, Esc/backdrop close,
 * focus). Enter in the title input confirms; generic Esc/backdrop close is
 * owned by Modal (maps to onCancel).
 */
export interface AddSectionPromptModalProps {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AddSectionPromptModal({
  open,
  value,
  onChange,
  onConfirm,
  onCancel,
}: AddSectionPromptModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={m.editor_addsection_title()}
      size="sm"
      initialFocusRef={inputRef}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={onCancel}
          >
            {m.common_cancel()}
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
          >
            {m.common_add()}
          </Button>
        </>
      }
    >
      <input
        ref={inputRef}
        type="text"
        className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-app text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4 focus:outline-none focus:ring-2 focus:ring-ih-primary"
        placeholder={m.editor_addsection_placeholder()}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
        }}
      />
    </Modal>
  );
}
