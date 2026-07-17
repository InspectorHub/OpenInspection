import { useState, useEffect, useRef } from "react";
import { Modal, Button } from "@core/shared-ui";
import type { ItemType } from "~/lib/editor/structure-ops";
import { m } from "~/paraglide/messages";

export interface AddItemTypeModalProps {
  open: boolean;
  onConfirm: (label: string, type: ItemType) => void;
  onCancel: () => void;
}

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

  /** The 9 item types (D8) with field-friendly labels. Built in render so the
   *  message functions resolve per-render (never frozen at import). */
  const ITEM_TYPES: Array<{ value: ItemType; label: string }> = [
    { value: "rich", label: m.editor_additem_type_rich() },
    { value: "boolean", label: m.editor_additem_type_boolean() },
    { value: "text", label: m.editor_additem_type_text() },
    { value: "textarea", label: m.editor_additem_type_textarea() },
    { value: "number", label: m.editor_additem_type_number() },
    { value: "select", label: m.editor_additem_type_select() },
    { value: "multi_select", label: m.editor_additem_type_multi_select() },
    { value: "date", label: m.editor_additem_type_date() },
    { value: "photo_only", label: m.editor_additem_type_photo_only() },
  ];

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
      title={m.editor_additem_title()}
      size="sm"
      initialFocusRef={labelRef}
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
            onClick={submit}
            data-testid="add-item-confirm"
          >
            {m.editor_additem_title()}
          </Button>
        </>
      }
    >
      <label className="block text-[12px] font-bold text-ih-fg-2">
        {m.editor_additem_label_label()}
        <input
          ref={labelRef}
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={m.editor_additem_label_placeholder()}
          className="mt-1 w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-app text-[13px] font-normal"
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          data-testid="add-item-label"
        />
      </label>
      <label className="block mt-4 text-[12px] font-bold text-ih-fg-2">
        {m.editor_additem_type_label()}
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
