import { useState } from "react";

const SHORTCUTS = [
  { keys: ["1", "-", "5"], desc: "Rate item" },
  { keys: ["J", "/", "K"], desc: "Next / Prev" },
  { keys: ["/"], desc: "Open library" },
  { keys: ["P"], desc: "Capture photo" },
  { keys: ["V"], desc: "Voice note" },
  { keys: ["R"], desc: "Repeat rating" },
  { keys: ["Z"], desc: "Speed mode" },
  { keys: ["G", "D"], desc: "Next defect" },
  { keys: ["Tab"], desc: "Next field" },
  { keys: ["Esc"], desc: "Cancel" },
  { keys: ["⌘", "\\"], desc: "Toggle sidebar" },
  { keys: ["?"], desc: "This help" },
];

export function FooterBar() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  return (
    <div className="fixed bottom-0 inset-x-0 z-30 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 px-4 py-1.5 flex items-center gap-3 text-[11px] text-slate-500">
      <div className="relative">
        <button
          onClick={() => setShortcutsOpen(!shortcutsOpen)}
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 font-bold text-[10px] hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <kbd className="px-1 py-0.5 bg-slate-100 dark:bg-slate-700 rounded text-[10px] font-mono border border-slate-200 dark:border-slate-600">?</kbd>
          Shortcuts
        </button>

        {shortcutsOpen && (
          <div className="absolute bottom-full left-0 mb-2 w-[320px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 p-3">
            <h4 className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">Keyboard shortcuts</h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              {SHORTCUTS.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="flex gap-0.5">
                    {s.keys.map((k, j) => (
                      <kbd key={j} className="px-1 py-0.5 bg-slate-100 dark:bg-slate-700 rounded text-[10px] font-mono border border-slate-200 dark:border-slate-600 min-w-[22px] text-center">{k}</kbd>
                    ))}
                  </span>
                  <span className="text-slate-600 dark:text-slate-300">{s.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <span className="flex-1" />

      {/* Sync status */}
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 font-bold text-[10px]">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        Synced
      </span>
    </div>
  );
}
