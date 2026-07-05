import { useRef } from "react";
import { Modal } from "@core/shared-ui";

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
      title="Add section"
      size="sm"
      initialFocusRef={inputRef}
      footer={
        <>
          <button
            onClick={onCancel}
            className="px-4 py-2 text-[13px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted rounded-md"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-[13px] font-bold text-white bg-ih-primary hover:bg-ih-primary/90 rounded-md"
          >
            Add
          </button>
        </>
      }
    >
      <input
        ref={inputRef}
        type="text"
        className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-app text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4 focus:outline-none focus:ring-2 focus:ring-ih-primary"
        placeholder="Section title (e.g. Roof)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
        }}
      />
    </Modal>
  );
}
