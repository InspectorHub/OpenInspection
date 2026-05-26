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
    <div className="fixed bottom-0 inset-x-0 z-30 bg-ih-bg-card border-t border-ih-border px-4 py-1.5 flex items-center gap-3 text-[11px] text-ih-fg-3">
      <div className="relative">
        <button
          onClick={() => setShortcutsOpen(!shortcutsOpen)}
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-ih-border font-bold text-[10px] hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <kbd className="px-1 py-0.5 bg-ih-bg-muted rounded text-[10px] font-mono border border-ih-border">?</kbd>
          Shortcuts
        </button>

        {shortcutsOpen && (
          <div className="absolute bottom-full left-0 mb-2 w-[320px] bg-ih-bg-card border border-ih-border rounded-lg shadow-lg z-50 p-3">
            <h4 className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">Keyboard shortcuts</h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              {SHORTCUTS.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="flex gap-0.5">
                    {s.keys.map((k, j) => (
                      <kbd key={j} className="px-1 py-0.5 bg-ih-bg-muted rounded text-[10px] font-mono border border-ih-border min-w-[22px] text-center">{k}</kbd>
                    ))}
                  </span>
                  <span className="text-ih-fg-3">{s.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <span className="flex-1" />

      {/* Sync status — reads from the inspection-edit page state */}
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-ih-border font-bold text-[10px]">
        <span className="w-1.5 h-1.5 rounded-full bg-ih-ok-bg0" />
        Connected
      </span>
    </div>
  );
}
