import { useState } from "react";

interface SideRailProps {
  activeItem?: { id: string; label: string } | null;
}

type TabId = "preview" | "library" | "recall";

const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: "preview", label: "Preview", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { id: "library", label: "Library", icon: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" },
  { id: "recall", label: "Recall", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
];

export function SideRail({ activeItem }: SideRailProps) {
  const [activeTab, setActiveTab] = useState<TabId>("preview");
  const [open, setOpen] = useState(false);

  const toggle = (tabId: TabId) => {
    if (activeTab === tabId && open) {
      setOpen(false);
    } else {
      setActiveTab(tabId);
      setOpen(true);
    }
  };

  return (
    <div className="flex h-full">
      {/* Content panel (256px, left of tab strip) */}
      {open && (
        <div className="w-64 border-l border-ih-border bg-ih-bg-card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-ih-border">
            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400 capitalize">{activeTab}</span>
            <button onClick={() => setOpen(false)} className="w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:text-slate-600">&#x2715;</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {activeTab === "preview" && (
              <p className="text-[13px] text-ih-fg-3 text-center py-8">Live preview of the active item's report rendering.</p>
            )}
            {activeTab === "library" && (
              <div>
                <input type="text" placeholder="Search comments..." className="w-full px-2 py-1.5 rounded border border-ih-border bg-ih-bg-app text-[12px] mb-2" />
                <p className="text-[13px] text-ih-fg-3 text-center py-8">Type <kbd className="px-1 py-0.5 bg-ih-bg-muted rounded text-[10px] font-mono border">/</kbd> in the note field to search.</p>
              </div>
            )}
            {activeTab === "recall" && (
              <p className="text-[13px] text-ih-fg-3 text-center py-8">Prior inspections' notes for similar items.</p>
            )}
          </div>
        </div>
      )}

      {/* 44px vertical tab strip */}
      <div className="w-11 flex-shrink-0 bg-ih-bg-app/50 border-l border-ih-border flex flex-col items-center py-2 gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => toggle(tab.id)}
            className={`relative w-10 flex flex-col items-center gap-0.5 py-2.5 rounded-r-md transition-all ${
              activeTab === tab.id && open
                ? "bg-ih-bg-card text-ih-primary shadow-sm border-l-2 border-indigo-600 dark:border-indigo-400 -ml-px"
                : "text-ih-fg-4 hover:text-slate-600 dark:hover:text-slate-400"
            }`}
            title={tab.label}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d={tab.icon} />
            </svg>
            <span className="text-[8px] font-bold uppercase tracking-[0.1em]" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
