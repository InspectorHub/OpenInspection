import { useState, useCallback, useEffect, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { Modal, Button, FileDropzone } from "@core/shared-ui";

export function CsvImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const fetcher = useFetcher();
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [parsing, setParsing] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // `!open` renders null but the component stays MOUNTED, so without this
  // reset a reopened modal resumes on the previous run's result step.
  useEffect(() => {
    if (open) {
      setStep("upload"); setCsvText(""); setFileName(""); setFileSize(null);
      setParsing(false); setFileError(null);
    }
  }, [open]);

  const preview = (fetcher.data as Record<string, unknown>)?.preview as Record<string, unknown> | undefined;
  const importResult = (fetcher.data as Record<string, unknown>)?.result as Record<string, unknown> | undefined;

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    setFileSize(file.size);
    setFileError(null);
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".xlsx")) {
      // Client-side parse (vendored ExcelJS, loaded on demand) → CSV text →
      // the same validate/import pipeline as a pasted CSV. The lazy library
      // load + workbook parse are async — surface it via the busy state.
      setParsing(true);
      import("~/lib/xlsx-import")
        .then((m) => m.parseXlsxFile(file))
        .then(setCsvText)
        .catch((err: unknown) => {
          setCsvText("");
          setFileName("");
          setFileSize(null);
          setFileError(err instanceof Error ? err.message : "Could not read the .xlsx file.");
        })
        .finally(() => setParsing(false));
      return;
    }
    if (lower.endsWith(".xls")) {
      // The 2003 binary format — ExcelJS doesn't read it; modern Excel/WPS/
      // Numbers all save as .xlsx in one step.
      setCsvText("");
      setFileName("");
      setFileSize(null);
      setFileError("Legacy .xls files aren't supported — save the file as .xlsx or CSV and retry.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText(ev.target?.result as string);
    reader.readAsText(file);
  }, []);

  const clearFile = useCallback(() => {
    setFileName(""); setFileSize(null); setCsvText(""); setFileError(null);
  }, []);

  // Shared derivations for the `done` step — body + footer both branch on these.
  const r = importResult as { inserted?: number; skipped?: number; errors?: { row: number; message: string }[] } | undefined;
  const errs = r?.errors ?? [];
  // Transport/server failure (non-2xx) — never paint it as success.
  const transportFailed = !!(fetcher.data && (fetcher.data as { ok?: boolean }).ok === false);

  // The footer buttons are step-dependent while the title stays static.
  let footer: ReactNode = null;
  if (step === "upload") {
    footer = (
      <Button
        variant="primary"
        onClick={() => {
          fetcher.submit({ intent: "csv-preview", csvText }, { method: "post" });
          setStep("preview");
        }}
        disabled={!csvText.trim()}
      >
        Preview
      </Button>
    );
  } else if (step === "preview") {
    footer = (
      <>
        <Button variant="secondary" onClick={() => setStep("upload")}>Back</Button>
        <button
          onClick={() => {
            fetcher.submit({ intent: "csv-import", csvText }, { method: "post" });
            setStep("done");
          }}
          className="px-5 py-2 rounded-lg bg-ih-ok text-white text-xs font-bold uppercase tracking-widest hover:bg-ih-ok/85"
        >
          Confirm Import
        </button>
      </>
    );
  } else if (step === "done") {
    if (transportFailed || errs.length > 0) {
      footer = (
        <>
          <Button variant="secondary" onClick={() => setStep("upload")}>Back to file</Button>
          <button onClick={onClose} className="px-5 py-2 rounded-lg bg-ih-bg-inverse text-ih-fg-inverse text-xs font-bold uppercase tracking-widest">Close</button>
        </>
      );
    } else {
      footer = (
        <button onClick={onClose} className="px-5 py-2 rounded-lg bg-ih-bg-inverse text-ih-fg-inverse text-xs font-bold uppercase tracking-widest">Done</button>
      );
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Import contacts from CSV" size="xl" footer={footer}>
      {step === "upload" && (
        <div className="space-y-4">
          <FileDropzone
            accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onFile={handleFile}
            fileName={fileName || null}
            fileSize={fileSize}
            busy={parsing}
            error={fileError}
            hint="CSV or Excel (.xlsx) — Spectora and ITB exports work out of the box"
            onClear={clearFile}
          />
          <div className="flex items-center gap-3 text-[11px] uppercase tracking-widest text-ih-fg-4">
            <span className="h-px flex-1 bg-ih-border" />
            or paste below
            <span className="h-px flex-1 bg-ih-border" />
          </div>
          <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={6} placeholder="...or paste CSV content here" className="w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-xs font-mono" />
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-4">
          {/* The preview endpoint reports parse results (columns + row count) —
              it does NOT pre-compute import outcomes. The old three-card
              imported/duplicates/errors grid here read fields the preview
              never returned, so it always rendered 0/0/0. */}
          <div className="grid grid-cols-2 gap-4 text-center">
            <div className="p-4 bg-ih-ok-bg rounded-lg">
              <div className="text-xl font-bold text-ih-ok-fg">{(preview as Record<string, number>)?.totalRowsDetected || 0}</div>
              <div className="text-xs text-ih-ok-fg mt-1">Rows detected</div>
            </div>
            <div className="p-4 bg-ih-watch-bg rounded-lg">
              <div className="text-xl font-bold text-ih-watch-fg">{((preview as Record<string, unknown[]>)?.columns?.length) || 0}</div>
              <div className="text-xs text-ih-watch-fg mt-1">Columns</div>
            </div>
          </div>
          {Array.isArray((preview as Record<string, unknown[]>)?.columns) && ((preview as Record<string, unknown[]>).columns?.length ?? 0) > 0 && (
            <p className="text-xs text-ih-fg-3 text-center">
              Detected columns: {((preview as Record<string, string[]>).columns ?? []).join(", ")}
            </p>
          )}
        </div>
      )}

      {step === "done" && (() => {
        if (transportFailed) {
          return (
            <div className="text-center space-y-3">
              <p className="text-lg font-bold text-ih-bad-fg">Import failed</p>
              <p className="text-sm text-ih-fg-3">The server rejected the import. Nothing was written — try again, and contact support if it persists.</p>
            </div>
          );
        }
        // B-29+ two-phase import: ANY row error means NOTHING was written —
        // the full error list comes back so the user fixes the file in one
        // pass and retries against an unchanged contact list.
        if (errs.length > 0) {
          return (
            <div className="space-y-4">
              <p className="text-lg font-bold text-ih-bad-fg text-center">Nothing was imported</p>
              <p className="text-sm text-ih-fg-3 text-center">
                The file imports all-or-nothing. Fix the rows below and retry — no duplicates will be created.
              </p>
              <ul className="text-xs text-ih-bad-fg bg-ih-bad-bg rounded-lg p-3 space-y-1 max-h-48 overflow-y-auto">
                {errs.slice(0, 50).map((e) => (
                  <li key={`${e.row}-${e.message}`}>Row {e.row}: {e.message}</li>
                ))}
                {errs.length > 50 && <li>…and {errs.length - 50} more</li>}
              </ul>
            </div>
          );
        }
        return (
          <div className="text-center">
            <div className="text-3xl mb-3">&#x2713;</div>
            <p className="text-lg font-bold text-ih-ok-fg">
              Imported {r?.inserted ?? 0} contacts
            </p>
            {(r?.skipped ?? 0) > 0 && (
              <p className="text-sm text-ih-fg-3 mt-1">
                {r?.skipped} skipped (blank name or already in your contacts)
              </p>
            )}
          </div>
        );
      })()}
    </Modal>
  );
}
