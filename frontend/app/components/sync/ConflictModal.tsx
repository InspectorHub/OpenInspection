import { useState } from "react";

export interface Conflict {
 id: string;
 field: string;
 itemId: string;
 base: string;
 ours: string;
 theirs: string;
}

interface ConflictModalProps {
 conflicts: Conflict[];
 open: boolean;
 onClose: () => void;
 onResolve: (conflictId: string, resolution: "ours" | "theirs" | "edit", merged?: string) => void;
 onResetLocal?: () => void;
}

export function ConflictModal({ conflicts, open, onClose, onResolve, onResetLocal }: ConflictModalProps) {
 const [index, setIndex] = useState(0);
 const [resetting, setResetting] = useState(false);
 const current = conflicts[index];

 if (!open || conflicts.length === 0) return null;

 async function handleReset() {
 setResetting(true);
 await onResetLocal?.();
 setResetting(false);
 }

 return (
 <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-labelledby="conflict-modal-title">
 <div className="bg-ih-bg-card rounded-lg shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col">
 <header className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center gap-4">
 <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-ih-watch-bg0 text-white flex-shrink-0" aria-hidden="true">
 <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
 </span>
 <div className="flex-1 min-w-0">
 <h2 id="conflict-modal-title" className="text-base font-bold text-ih-fg-1">{conflicts.length} conflict{conflicts.length !== 1 ? "s" : ""} need your input</h2>
 <p className="text-xs text-ih-fg-3 mt-0.5">These fields were edited on more than one device while offline. Pick the version that should win for each.</p>
 </div>
 <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md text-xs font-bold border border-ih-border text-ih-fg-3 hover:bg-ih-bg-muted transition-colors">Resolve later</button>
 </header>

 <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[260px_1fr]">
 <aside className="border-r border-slate-100 dark:border-slate-700 overflow-y-auto bg-slate-50/50 dark:bg-slate-900/40 flex flex-col">
 <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100 dark:border-slate-700">
 <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ih-fg-4">Queue</span>
 <span className="text-[10px] font-mono text-ih-fg-4">{index + 1} / {conflicts.length}</span>
 </div>
 <ul className="flex-1 divide-y divide-slate-100 dark:divide-slate-700">
 {conflicts.map((c, i) => (
 <li key={c.id}>
 <button type="button" onClick={() => setIndex(i)} className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors border-l-[2px] ${i === index ? "bg-ih-primary-tint border-indigo-500" : "border-transparent hover:bg-white dark:hover:bg-slate-700/50"}`}>
 <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-mono font-bold flex-shrink-0 mt-0.5 ${i === index ? "bg-indigo-500 text-white" : "bg-ih-bg-muted text-ih-fg-2"}`}>{i + 1}</span>
 <div className="flex-1 min-w-0">
 <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-ih-fg-4">{c.field}</div>
 <div className={`text-[12px] mt-0.5 truncate ${i === index ? "text-ih-primary font-bold" : "text-ih-fg-1 font-semibold"}`}>{c.itemId}</div>
 </div>
 </button>
 </li>
 ))}
 </ul>
 <div className="border-t border-ih-border p-3">
 <button type="button" onClick={handleReset} disabled={resetting} className="w-full px-3 py-2 rounded-md text-[11px] font-bold uppercase tracking-[0.14em] border border-ih-bad text-ih-bad-fg hover:bg-ih-bad-bg dark:hover:bg-rose-900/20 disabled:opacity-50 transition-colors">
 {resetting ? "Resetting..." : "Reset local copy & reload"}
 </button>
 <p className="text-[10px] text-ih-fg-4 mt-1.5 leading-snug">Use only if you are stuck. Discards every offline edit on this device.</p>
 </div>
 </aside>

 {current && (
 <section className="flex flex-col overflow-hidden">
 <header className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
 <div className="flex items-center gap-3 mb-1">
 <span className="text-[10px] font-mono font-bold text-ih-fg-4">Conflict {index + 1} of {conflicts.length}</span>
 <span className="ih-pill ih-pill--monitor">{current.field === "rating" ? "Rating disagreement" : "Note divergence"}</span>
 </div>
 <h3 className="text-xl font-bold tracking-tight text-ih-fg-1">{current.itemId}</h3>
 <p className="text-xs text-ih-fg-3 mt-1">field <span className="font-mono font-semibold">{current.field}</span></p>
 </header>
 <div className="flex-1 overflow-y-auto p-6">
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 <div>
 <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-ih-fg-4 mb-1.5">Base - last synced</div>
 <pre className="bg-ih-bg-app/40 border border-ih-border rounded-md p-3 text-[12px] text-ih-fg-2 whitespace-pre-wrap leading-relaxed">{current.base}</pre>
 </div>
 <div>
 <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-ih-primary mb-1.5">Yours - while offline</div>
 <pre className="bg-ih-primary-tint border border-ih-primary-tint rounded-md p-3 text-[12px] text-ih-primary whitespace-pre-wrap leading-relaxed">{current.ours}</pre>
 </div>
 <div>
 <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-ih-bad-fg mb-1.5">Theirs - server</div>
 <pre className="bg-ih-bad-bg border border-ih-bad rounded-md p-3 text-[12px] text-rose-900 dark:text-rose-100 whitespace-pre-wrap leading-relaxed">{current.theirs}</pre>
 </div>
 </div>
 </div>
 <footer className="border-t border-slate-100 dark:border-slate-700 px-6 py-4 flex items-center gap-2 flex-wrap">
 <p className="text-[11px] text-ih-fg-3 flex-1 leading-snug max-w-[260px]">Pick a winner per field. Edit merged opens a free-form editor when both sides are partially correct.</p>
 <button type="button" onClick={() => onResolve(current.id, "edit")} className="px-3 py-2 rounded-md text-[12px] font-bold border border-ih-border text-ih-fg-2 hover:bg-ih-bg-muted transition-colors inline-flex items-center gap-1.5">Edit merged</button>
 <button type="button" onClick={() => onResolve(current.id, "theirs")} className="px-3 py-2 rounded-md text-[12px] font-bold border border-ih-bad text-ih-bad-fg hover:bg-ih-bad-bg dark:hover:bg-rose-900/20 transition-colors">Take theirs</button>
 <button type="button" onClick={() => onResolve(current.id, "ours")} className="px-4 py-2 rounded-md text-[12px] font-bold bg-ih-primary hover:bg-ih-primary-600 text-white transition-colors">Keep mine</button>
 </footer>
 </section>
 )}
 </div>
 </div>
 </div>
 );
}
