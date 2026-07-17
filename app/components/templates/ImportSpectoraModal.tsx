import { useRef } from "react";
import { Modal } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

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
      title={m.templates_import_title()}
      size="lg"
      initialFocusRef={nameRef}
      footer={
        <>
          <button
            type="button"
            onClick={() => setImportOpen(false)}
            className="h-8 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3"
          >
            {m.common_cancel()}
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!importName.trim() || !importPayload.trim()}
            className="h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {m.templates_import_submit()}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-[12px] font-bold text-ih-fg-3 mb-1">{m.templates_name_label()}</label>
          <input
            ref={nameRef}
            value={importName}
            onChange={(e) => setImportName(e.target.value)}
            placeholder={m.templates_import_name_placeholder()}
            className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] outline-none focus:shadow-ih-focus"
          />
        </div>
        <div>
          <label className="block text-[12px] font-bold text-ih-fg-3 mb-1">{m.templates_import_json_label()}</label>
          <textarea
            value={importPayload}
            onChange={(e) => setImportPayload(e.target.value)}
            rows={8}
            placeholder={m.templates_import_json_placeholder()}
            className="w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-mono outline-none focus:shadow-ih-focus"
          />
        </div>
      </div>
    </Modal>
  );
}
