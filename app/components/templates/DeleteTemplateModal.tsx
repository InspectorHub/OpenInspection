interface DeleteTemplateModalProps {
  setDeleteConfirm: (id: string | null) => void;
  handleDelete: () => void;
}

export function DeleteTemplateModal({ setDeleteConfirm, handleDelete }: DeleteTemplateModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.4)] backdrop-blur-sm" onClick={() => setDeleteConfirm(null)}>
      <div className="w-full max-w-xs bg-ih-bg-card rounded-xl shadow-ih-popover p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[16px] font-bold text-ih-fg-1 mb-2">Delete Template</h2>
        <p className="text-[13px] text-ih-fg-3 mb-5">
          Are you sure you want to delete this template? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={() => setDeleteConfirm(null)} className="h-8 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3">
            Cancel
          </button>
          <button onClick={handleDelete} className="h-8 px-4 rounded-md bg-ih-bad-fg text-white font-bold text-[13px] hover:bg-ih-bad-fg">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
