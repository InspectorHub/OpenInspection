import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router";

interface Action {
  id: string;
  label: string;
  group: string;
  icon: string;
  to?: string;
  onSelect?: () => void;
}

const NAV_ACTIONS: Action[] = [
  { id: "nav-dashboard", label: "Dashboard", group: "Navigation", icon: "▦", to: "/dashboard" },
  { id: "nav-calendar", label: "Calendar", group: "Navigation", icon: "☰", to: "/calendar" },
  { id: "nav-contacts", label: "Contacts", group: "Navigation", icon: "☺", to: "/contacts" },
  { id: "nav-invoices", label: "Invoices", group: "Navigation", icon: "☶", to: "/invoices" },
  { id: "nav-templates", label: "Templates", group: "Navigation", icon: "⬚", to: "/templates" },
  { id: "nav-metrics", label: "Metrics", group: "Navigation", icon: "△", to: "/metrics" },
  { id: "nav-settings", label: "Settings", group: "Navigation", icon: "⚙", to: "/settings" },
];

const QUICK_ACTIONS: Action[] = [
  { id: "qa-new-inspection", label: "New Inspection", group: "Quick Actions", icon: "+" },
  { id: "qa-new-template", label: "New Template", group: "Quick Actions", icon: "+" },
  { id: "qa-import", label: "Import Spectora", group: "Quick Actions", icon: "↓" },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function CommandPalette({ onNewInspection }: { onNewInspection?: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery("");
        setActiveIdx(0);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const allActions = [...NAV_ACTIONS, ...QUICK_ACTIONS];
  const filtered = query.length === 0
    ? allActions
    : allActions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()));

  // Group the filtered results
  const groups = new Map<string, Action[]>();
  for (const a of filtered) {
    const list = groups.get(a.group) || [];
    list.push(a);
    groups.set(a.group, list);
  }

  const flatFiltered = filtered;
  const safeIdx = Math.min(activeIdx, flatFiltered.length - 1);

  const executeAction = useCallback((action: Action) => {
    setOpen(false);
    if (action.to) {
      navigate(action.to);
    } else if (action.id === "qa-new-inspection" && onNewInspection) {
      onNewInspection();
    }
  }, [navigate, onNewInspection]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flatFiltered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && flatFiltered[safeIdx]) {
      e.preventDefault();
      executeAction(flatFiltered[safeIdx]);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] bg-black/30 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-[14px] text-slate-900 dark:text-slate-100 outline-none placeholder:text-slate-400"
          />
          <kbd className="hidden sm:inline px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-[10px] font-bold text-slate-400">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[300px] overflow-y-auto py-2">
          {flatFiltered.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-slate-400">No results found</p>
          ) : (
            [...groups.entries()].map(([group, actions]) => (
              <div key={group}>
                <p className="px-4 py-1 text-[10px] font-extrabold uppercase tracking-[0.15em] text-slate-400">{group}</p>
                {actions.map((action) => {
                  const idx = flatFiltered.indexOf(action);
                  return (
                    <button
                      key={action.id}
                      onClick={() => executeAction(action)}
                      onMouseEnter={() => setActiveIdx(idx)}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-[13px] transition-colors ${idx === safeIdx ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400" : "text-slate-700 dark:text-slate-300"}`}
                    >
                      <span className="w-5 text-center text-[14px] opacity-60">{action.icon}</span>
                      <span className="font-medium">{action.label}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-200 dark:border-slate-700 text-[10px] text-slate-400">
          <span><kbd className="font-bold">&uarr;&darr;</kbd> navigate</span>
          <span><kbd className="font-bold">Enter</kbd> select</span>
          <span><kbd className="font-bold">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  );
}
