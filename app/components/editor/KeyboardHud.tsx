import { useState, useEffect } from "react";

interface ShortcutColumn {
  title: string;
  rows: { key: string; label: string }[];
}

const COLUMNS: ShortcutColumn[] = [
  { title: "Navigate", rows: [
    { key: "Up/Down", label: "Next / previous item" },
    { key: "Enter",   label: "Next item" },
    { key: "Shift+Enter", label: "Previous item" },
    { key: "GS",   label: "Jump to section" },
    { key: "Cmd+K", label: "Command palette" },
    { key: "Ctrl+/", label: "Command palette (Win)" },
  ]},
  { title: "Rating", rows: [
    { key: "1", label: "Satisfactory" },
    { key: "2", label: "Monitor" },
    { key: "3", label: "Defect" },
    { key: "4", label: "Not Inspected" },
    { key: "5", label: "Not Present" },
    { key: "0", label: "Clear rating" },
    { key: "N", label: "Mark Not Applicable" },
  ]},
  { title: "Content", rows: [
    { key: "/", label: "Open Comment Library" },
    { key: ";", label: "Insert snippet" },
    { key: "P", label: "Add photo" },
    { key: "T", label: "Add tag" },
    { key: "Cmd+D", label: "Save current as snippet" },
  ]},
  { title: "View", rows: [
    { key: "Cmd+1", label: "Three-pane layout" },
    { key: "Cmd+2", label: "Focus mode" },
    { key: "Cmd+3", label: "Preview" },
    { key: "Cmd+S", label: "Save" },
    { key: "Cmd+Shift+P", label: "Publish" },
  ]},
];

export function KeyboardHud() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!open) return null;

  return (
    <div className="hidden md:flex fixed inset-0 z-[9999] items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div className="absolute inset-0 bg-slate-900/85 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative bg-white rounded-lg shadow-md border border-slate-200 max-w-4xl w-full max-h-[85vh] overflow-y-auto">
        <header className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Keyboard shortcuts</h2>
            <p className="text-xs text-ih-fg-3 mt-0.5">Press <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-mono">?</kbd> to toggle, <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-mono">Esc</kbd> to close</p>
          </div>
          <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700 text-xl leading-none" aria-label="Close">&times;</button>
        </header>
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">{col.title}</h3>
              <ul className="space-y-2">
                {col.rows.map((row) => (
                  <li key={row.key} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-slate-600 leading-tight">{row.label}</span>
                    <kbd className="shrink-0 px-2 py-0.5 bg-slate-50 border border-slate-200 rounded text-[11px] font-mono text-slate-700 min-w-[28px] text-center">{row.key}</kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <footer className="px-6 py-3 border-t border-slate-100 text-[10px] text-slate-400 italic">
          Shortcuts marked with Cmd require platform meta key on Mac. Some shortcuts may be inactive until that feature ships.
        </footer>
      </div>
    </div>
  );
}
