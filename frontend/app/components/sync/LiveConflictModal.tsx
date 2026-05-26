import { useState } from "react";

interface LiveConflict {
  field: string;
  itemId: string;
  yours: { value: string };
  theirs: { value: string; by?: string; at?: string };
}

interface LiveConflictModalProps {
  conflict: LiveConflict;
  open: boolean;
  onResolve: (resolution: "keep-mine" | "keep-theirs" | "merge", merged?: string) => void;
}

export function LiveConflictModal({ conflict, open, onResolve }: LiveConflictModalProps) {
  const [action, setAction] = useState<"pick" | "merge">("pick");
  const [mergedValue, setMergedValue] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  async function handleResolve(resolution: "keep-mine" | "keep-theirs" | "merge") {
    setSaving(true);
    await onResolve(resolution, resolution === "merge" ? mergedValue : undefined);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="Resolve concurrent edit">
      <div className="ih-card max-w-3xl w-full max-h-[90vh] overflow-y-auto bg-white">
        <header className="px-6 py-4 border-b border-slate-200">
          <h2 className="ih-h2">Resolve concurrent edit</h2>
          <p className="ih-meta mt-1">
            {conflict.field} on {conflict.itemId} — last edited by <strong>{conflict.theirs.by || "another inspector"}</strong>
            {conflict.theirs.at && <> · {conflict.theirs.at}</>}
          </p>
        </header>

        <div className="grid grid-cols-2 gap-0 border-b border-slate-200">
          <div className="p-4 border-r border-slate-200 bg-ih-watch-bg">
            <div className="ih-eyebrow mb-2 text-amber-800">Yours</div>
            <pre className="text-sm whitespace-pre-wrap">{String(conflict.yours.value ?? "")}</pre>
          </div>
          <div className="p-4 bg-sky-50">
            <div className="ih-eyebrow mb-2 text-sky-800">Theirs (server)</div>
            <pre className="text-sm whitespace-pre-wrap">{String(conflict.theirs.value ?? "")}</pre>
          </div>
        </div>

        {action === "merge" && (
          <div className="p-4 border-b border-slate-200">
            <label className="ih-eyebrow block mb-2">Merged value</label>
            <textarea className="ih-input w-full h-32" value={mergedValue} onChange={(e) => setMergedValue(e.target.value)} aria-label="Merged value" />
          </div>
        )}

        <footer className="px-6 py-4 flex justify-end gap-2 bg-slate-50">
          <button type="button" className="ih-btn ih-btn--ghost" onClick={() => handleResolve("keep-theirs")}>Keep theirs</button>
          {action !== "merge" ? (
            <>
              <button type="button" className="ih-btn ih-btn--secondary" onClick={() => setAction("merge")}>Merge...</button>
              <button type="button" className="ih-btn ih-btn--primary" onClick={() => handleResolve("keep-mine")} disabled={saving}>Keep mine</button>
            </>
          ) : (
            <button type="button" className="ih-btn ih-btn--primary" onClick={() => handleResolve("merge")} disabled={saving || !mergedValue.length}>Save merged</button>
          )}
        </footer>
      </div>
    </div>
  );
}
