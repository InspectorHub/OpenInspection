interface CreateTemplateModalProps {
  setCreateOpen: (open: boolean) => void;
  newName: string;
  setNewName: (name: string) => void;
  handleCreate: () => void;
  error?: unknown;
}

export function CreateTemplateModal({
  setCreateOpen,
  newName,
  setNewName,
  handleCreate,
  error,
}: CreateTemplateModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.4)] backdrop-blur-sm" onClick={() => setCreateOpen(false)}>
      <div className="w-full max-w-sm bg-ih-bg-card rounded-xl shadow-ih-popover p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-bold text-ih-fg-1">New Template</h2>
          <button onClick={() => setCreateOpen(false)} className="text-ih-fg-4 hover:text-ih-fg-2 text-lg">&times;</button>
        </div>
        <div>
          <label className="block text-[12px] font-bold text-ih-fg-3 mb-1">Template name</label>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="e.g. Residential Full"
            autoFocus
            className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] outline-none focus:shadow-ih-focus"
          />
        </div>
        <div className="flex justify-end mt-5">
          <button
            onClick={handleCreate}
            disabled={!newName.trim()}
            className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create Template
          </button>
        </div>
        {typeof error === "string" && (
          <p className="mt-3 text-[12px] text-ih-bad-fg font-medium">{error}</p>
        )}
      </div>
    </div>
  );
}
