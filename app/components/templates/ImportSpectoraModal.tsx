import { useRef } from "react";
import { Modal } from "@core/shared-ui";

interface ImportSpectoraModalProps {
  open: boolean;
  setImportOpen: (open: boolean) => void;
  importName: string;
  setImportName: (name: string) => void;
  importPayload: string;
  setImportPayload: (payload: string) => void;
  handleImport: () => void;
}

export function ImportSpectoraModal({
  open,
  setImportOpen,
  importName,
  setImportName,
  importPayload,
  setImportPayload,
  handleImport,
}: ImportSpectoraModalProps) {
  const nameRef = useRef<HTMLInputElement>(null);

  return (
    <Modal
      open={open}
      onClose={() => setImportOpen(false)}
      title="Import from Spectora"
      size="lg"
      initialFocusRef={nameRef}
      footer={
        <>
          <button
            type="button"
            onClick={() => setImportOpen(false)}
            className="h-8 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!importName.trim() || !importPayload.trim()}
            className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Import
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-[12px] font-bold text-ih-fg-3 mb-1">Template name</label>
          <input
            ref={nameRef}
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
            placeholder="Paste your Spectora export JSON here..."
            className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-mono outline-none focus:shadow-ih-focus"
          />
        </div>
      </div>
    </Modal>
  );
}
