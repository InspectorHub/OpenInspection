import { useState, useCallback } from "react";

interface MintObserverLinkModalProps {
  open: boolean;
  inspectionId: string;
  onClose?: () => void;
}

export function MintObserverLinkModal({ open, inspectionId, onClose }: MintObserverLinkModalProps) {
  const [durationSeconds, setDurationSeconds] = useState(604800);
  const [generatedUrl, setGeneratedUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const mint = useCallback(async () => {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/observer-links`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durationSeconds }),
      });
      if (!res.ok) throw new Error("Failed to generate link");
      const data = await res.json();
      setGeneratedUrl(data.url ?? "");
    } catch {
      setError("Could not generate observer link");
    } finally {
      setSubmitting(false);
    }
  }, [inspectionId, durationSeconds]);

  function copyUrl() {
    navigator.clipboard?.writeText(generatedUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function close() {
    setGeneratedUrl("");
    setCopied(false);
    setError("");
    onClose?.();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="Share live view">
      <div className="max-w-md w-full p-6 bg-white dark:bg-slate-800 rounded-xl shadow-2xl">
        <h2 className="text-xl font-bold mb-2 text-slate-900 dark:text-slate-100">Share live view</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          Generate a one-time read-only link a buyer or agent can use to watch this inspection live. No account needed.
        </p>
        <label className="block mb-4">
          <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Duration</span>
          <select
            className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-md text-sm font-medium bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            value={durationSeconds}
            onChange={(e) => setDurationSeconds(Number(e.target.value))}
          >
            <option value={3600}>1 hour</option>
            <option value={86400}>1 day</option>
            <option value={604800}>7 days (default)</option>
          </select>
        </label>
        {generatedUrl && (
          <div className="p-3 mb-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-md space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-800 dark:text-emerald-300">Live-view link (one-time)</div>
            <input className="w-full px-2 py-1 border border-emerald-300 dark:border-emerald-600 rounded text-xs font-mono bg-white dark:bg-slate-900" value={generatedUrl} readOnly onClick={(e) => (e.target as HTMLInputElement).select()} />
            <div className="flex gap-2">
              <button className="px-3 h-7 rounded-md bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700" onClick={copyUrl}>Copy link</button>
              {copied && <span className="text-xs text-emerald-700 dark:text-emerald-300 self-center">Copied!</span>}
            </div>
          </div>
        )}
        {error && <p className="text-xs text-rose-600 mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="px-3 h-9 rounded-md border border-slate-200 dark:border-slate-600 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700" onClick={close}>Close</button>
          {!generatedUrl && (
            <button className="px-3 h-9 rounded-md bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 disabled:opacity-50" onClick={mint} disabled={submitting}>
              Generate link
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
