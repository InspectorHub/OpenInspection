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
    <div className="flex flex-wrap items-center border-b border-slate-200 dark:border-slate-700">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 border-b-2 text-[13px] font-bold transition-all ${
            activeId === tab.id
              ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
              : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
          }`}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold tabular-nums ${
              activeId === tab.id
                ? "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400"
                : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
            }`}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
