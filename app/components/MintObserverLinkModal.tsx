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
 const data = (await res.json()) as { url?: string };
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
 <div className="max-w-md w-full p-6 bg-ih-bg-card rounded-xl shadow-2xl">
 <h2 className="text-xl font-bold mb-2 text-ih-fg-1">Share live view</h2>
 <p className="text-sm text-ih-fg-3 mb-4">
 Generate a one-time read-only link a buyer or agent can use to watch this inspection live. No account needed.
 </p>
 <label className="block mb-4">
 <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Duration</span>
 <select
 className="w-full px-3 py-2 border border-ih-border rounded-md text-sm font-medium bg-ih-bg-card text-ih-fg-1"
 value={durationSeconds}
 onChange={(e) => setDurationSeconds(Number(e.target.value))}
 >
 <option value={3600}>1 hour</option>
 <option value={86400}>1 day</option>
 <option value={604800}>7 days (default)</option>
 </select>
 </label>
 {generatedUrl && (
 <div className="p-3 mb-4 bg-ih-ok-bg border border-ih-ok rounded-md space-y-2">
 <div className="text-[10px] font-bold uppercase tracking-widest text-ih-ok-fg">Live-view link (one-time)</div>
 <input className="w-full px-2 py-1 border border-ih-ok rounded text-xs font-mono bg-ih-bg-card" value={generatedUrl} readOnly onClick={(e) => (e.target as HTMLInputElement).select()} />
 <div className="flex gap-2">
 <button className="px-3 h-7 rounded-md bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700" onClick={copyUrl}>Copy link</button>
 {copied && <span className="text-xs text-ih-ok-fg self-center">Copied!</span>}
 </div>
 </div>
 )}
 {error && <p className="text-xs text-ih-bad-fg mb-3">{error}</p>}
 <div className="flex justify-end gap-2">
 <button className="px-3 h-9 rounded-md border border-ih-border text-sm font-medium hover:bg-ih-bg-muted" onClick={close}>Close</button>
 {!generatedUrl && (
 <button className="px-3 h-9 rounded-md bg-ih-primary text-white text-sm font-bold hover:bg-ih-primary-600 disabled:opacity-50" onClick={mint} disabled={submitting}>
 Generate link
 </button>
 )}
 </div>
 </div>
 </div>
 );
}
