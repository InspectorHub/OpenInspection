import { useState, useEffect, useRef } from "react";
import { Modal, Button } from "@core/shared-ui";
import type { ItemType } from "~/lib/editor/structure-ops";

export interface AddItemTypeModalProps {
  open: boolean;
  onConfirm: (label: string, type: ItemType) => void;
  onCancel: () => void;
}

/** The 9 item types (D8) with field-friendly labels. */
const ITEM_TYPES: Array<{ value: ItemType; label: string }> = [
  { value: "rich", label: "Rating + comments" },
  { value: "boolean", label: "Yes / No" },
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "select", label: "Single choice" },
  { value: "multi_select", label: "Multiple choice" },
  { value: "date", label: "Date" },
  { value: "photo_only", label: "Photos only" },
];

/**
 * "Add item" modal (D8) — label input + type picker. NEVER window.prompt.
 * Resets its fields each time it opens (the component now stays mounted under
 * the shared Modal primitive, so a reset-on-open effect replaces the previous
 * reliance on reset-on-submit for fresh state).
 */
export function AddItemTypeModal({ open, onConfirm, onCancel }: AddItemTypeModalProps) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<ItemType>("rich");
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setLabel(""); setType("rich"); }
  }, [open]);

  const submit = () => {
    onConfirm(label, type);
    setLabel("");
    setType("rich");
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Add item"
      size="sm"
      initialFocusRef={labelRef}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            data-testid="add-item-confirm"
          >
            Add item
          </Button>
        </>
      }
    >
      <label className="block text-[12px] font-bold text-ih-fg-2">
        Label
        <input
          ref={labelRef}
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="New item"
          className="mt-1 w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-app text-[13px] font-normal"
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          data-testid="add-item-label"
        />
      </label>
      <label className="block mt-4 text-[12px] font-bold text-ih-fg-2">
        Type
        <select
          value={type}
          onChange={(e) => setType(e.target.value as ItemType)}
          className="mt-1 w-full h-9 px-2 rounded-md border border-ih-border bg-ih-bg-app text-[13px] font-normal"
          data-testid="add-item-type"
        >
          {ITEM_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </label>
    </Modal>
  );
}
