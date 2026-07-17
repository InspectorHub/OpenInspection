import { useRef } from "react";
import { Modal } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

interface CreateTemplateModalProps {
  open: boolean;
  setCreateOpen: (open: boolean) => void;
  newName: string;
  setNewName: (name: string) => void;
  handleCreate: () => void;
  error?: unknown;
}

export function CreateTemplateModal({
  open,
  setCreateOpen,
  newName,
  setNewName,
  handleCreate,
  error,
}: CreateTemplateModalProps) {
  const nameRef = useRef<HTMLInputElement>(null);

  return (
    <Modal
      open={open}
      onClose={() => setCreateOpen(false)}
      title={m.templates_create_title()}
      size="sm"
      initialFocusRef={nameRef}
      footer={
        <button
          type="button"
          onClick={handleCreate}
          disabled={!newName.trim()}
          className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {m.templates_create_submit()}
        </button>
      }
    >
      <div>
        <label className="block text-[12px] font-bold text-ih-fg-3 mb-1">{m.templates_name_label()}</label>
        <input
          ref={nameRef}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder={m.templates_create_name_placeholder()}
          className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] outline-none focus:shadow-ih-focus"
        />
      </div>
      {typeof error === "string" && (
        <p className="mt-3 text-[12px] text-ih-bad-fg font-medium">{error}</p>
      )}
    </Modal>
  );
}
