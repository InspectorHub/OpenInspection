interface ImportSpectoraModalProps {
  setImportOpen: (open: boolean) => void;
  importName: string;
  setImportName: (name: string) => void;
  importPayload: string;
  setImportPayload: (payload: string) => void;
  handleImport: () => void;
}

export function ImportSpectoraModal({
  setImportOpen,
  importName,
  setImportName,
  importPayload,
  setImportPayload,
  handleImport,
}: ImportSpectoraModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.4)] backdrop-blur-sm" onClick={() => setImportOpen(false)}>
      <div className="w-full max-w-lg bg-ih-bg-card rounded-xl shadow-ih-popover p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-bold text-ih-fg-1">Import from Spectora</h2>
          <button onClick={() => setImportOpen(false)} className="text-ih-fg-4 hover:text-ih-fg-2 text-lg">&times;</button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-[12px] font-bold text-ih-fg-3 mb-1">Template name</label>
            <input
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
              placeholder="e.g. Spectora Residential"
              className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] outline-none focus:shadow-ih-focus"
            />
          </div>
          <div>
            <label className="block text-[12px] font-bold text-ih-fg-3 mb-1">Spectora export JSON</label>
            <textarea
              value={importPayload}
              onChange={(e) => setImportPayload(e.target.value)}
              rows={8}
              placeholder='Paste your Spectora export JSON here...'
              className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-mono outline-none focus:shadow-ih-focus"
            />
          </div>
        </div>
        <div className="flex justify-end mt-5 gap-2">
          <button onClick={() => setImportOpen(false)} className="h-8 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3">
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!importName.trim() || !importPayload.trim()}
            className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
