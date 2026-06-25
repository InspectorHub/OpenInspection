/**
 * D8 — "Add section" title prompt modal.
 *
 * Extracted from the inlined JSX in inspection-edit.tsx so the per-section
 * structural-edit block has a proper component boundary. Behavior is
 * verbatim — same DS tokens, same keyboard handling (Enter = confirm,
 * Escape = cancel), same layout.
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
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-[rgba(15,23,42,0.6)] backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="relative bg-ih-bg-card rounded-lg shadow-ih-popover p-6 max-w-sm w-full border border-ih-border">
        <h3 className="text-[15px] font-bold text-ih-fg-1">Add section</h3>
        <input
          type="text"
          autoFocus
          className="mt-3 w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-app text-[13px] text-ih-fg-1 placeholder:text-ih-fg-4 focus:outline-none focus:ring-2 focus:ring-ih-primary"
          placeholder="Section title (e.g. Roof)"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
            if (e.key === "Escape") { e.preventDefault(); onCancel(); }
          }}
        />
        <div className="flex justify-end gap-2 mt-4">
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
        </div>
      </div>
    </div>
  );
}
