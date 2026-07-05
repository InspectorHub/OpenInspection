import { Modal } from "@core/shared-ui";

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
      title="Delete Template"
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={() => setDeleteConfirm(null)}
            className="h-8 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="h-8 px-4 rounded-md bg-ih-bad-fg text-white font-bold text-[13px] hover:bg-ih-bad-fg"
          >
            Delete
          </button>
        </>
      }
    >
      <p className="text-[13px] text-ih-fg-3">
        Are you sure you want to delete this template? This cannot be undone.
      </p>
    </Modal>
  );
}
