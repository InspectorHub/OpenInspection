import { useRef } from "react";
import { Modal, Button } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export interface SaveTemplateModalProps {
  /** Non-null while open: 'back' updates the source template, 'new' forks a copy. */
  mode: "back" | "new" | null;
  /** Name input value (only used in 'new' mode). */
  name: string;
  onChangeName: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * D8 — "Save structure to template" modal. Two modes:
 *  - 'back': overwrite the inspection's SOURCE template with the current
 *    structure (warns that future inspections pick it up; published reports
 *    keep their frozen snapshot).
 *  - 'new': fork the current structure into a brand-new template (needs a name).
 * Custom modal — NEVER window.confirm / window.prompt.
 */
export function SaveTemplateModal({ mode, name, onChangeName, onConfirm, onCancel }: SaveTemplateModalProps) {
  const isNew = mode === "new";
  const nameRef = useRef<HTMLInputElement>(null);

  return (
    <Modal
      open={mode !== null}
      onClose={onCancel}
      title={isNew ? m.editor_savetpl_title_new() : m.editor_savetpl_title_back()}
      size="sm"
      initialFocusRef={nameRef}
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
            data-testid="save-template-confirm"
          >
            {isNew ? m.editor_savetpl_confirm_new() : m.editor_savetpl_confirm_back()}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-ih-fg-3">
        {isNew
          ? m.editor_savetpl_body_new()
          : m.editor_savetpl_body_back()}
      </p>
      {isNew && (
        <label className="block mt-4 text-[12px] font-bold text-ih-fg-2">
          {m.editor_savetpl_name_label()}
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => onChangeName(e.target.value)}
            placeholder={m.editor_savetpl_name_placeholder()}
            className="mt-1 w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-app text-[13px] font-normal"
            onKeyDown={(e) => { if (e.key === "Enter") onConfirm(); }}
            data-testid="save-template-name"
          />
        </label>
      )}
    </Modal>
  );
}
