import { Modal } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

interface DeleteTemplateModalProps {
  open: boolean;
  setDeleteConfirm: (id: string | null) => void;
  handleDelete: () => void;
}

export function DeleteTemplateModal({ open, setDeleteConfirm, handleDelete }: DeleteTemplateModalProps) {
  return (
    <Modal
      open={open}
      onClose={() => setDeleteConfirm(null)}
      title={m.templates_delete_title()}
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={() => setDeleteConfirm(null)}
            className="h-8 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3"
          >
            {m.common_cancel()}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="h-8 px-4 rounded-md bg-ih-bad-fg text-white font-bold text-[13px] hover:bg-ih-bad-fg"
          >
            {m.common_delete()}
          </button>
        </>
      }
    >
      <p className="text-[13px] text-ih-fg-3">
        {m.templates_delete_body()}
      </p>
    </Modal>
  );
}
