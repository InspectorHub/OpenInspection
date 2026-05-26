import React from "react";

interface Tab {
  id: string;
  label: string;
  count?: number;
}

interface TabStripProps {
  tabs: Tab[];
  activeId: string;
  onChange: (id: string) => void;
}

export function TabStrip({ tabs, activeId, onChange }: TabStripProps) {
  return (
    <div className="flex flex-wrap items-center border-b border-ih-border">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 border-b-2 text-[13px] font-bold transition-all ${
            activeId === tab.id
              ? "border-ih-primary text-ih-primary"
              : "border-transparent text-ih-fg-3 hover:text-ih-fg-1"
          }`}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold tabular-nums ${
              activeId === tab.id
                ? "bg-ih-primary-tint text-ih-primary"
                : "bg-ih-bg-muted text-ih-fg-4"
            }`}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
