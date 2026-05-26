interface WorkflowTab {
  id: string;
  label: string;
  count: number;
}

interface WorkflowTabsProps {
  tabs: WorkflowTab[];
  selected: string;
  onSelect?: (id: string) => void;
}

export function WorkflowTabs({ tabs, selected, onSelect }: WorkflowTabsProps) {
  return (
    <nav className="flex flex-wrap items-center border-b border-ih-border -mb-px">
      {tabs.map((t) => (
        <button
          key={t.id}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 border-b-2 text-[13px] font-bold transition-all ${
            selected === t.id
              ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
              : "border-transparent text-ih-fg-3 hover:text-slate-900 dark:hover:text-slate-200"
          }`}
          onClick={() => onSelect?.(t.id)}
        >
          <span>{t.label}</span>
          <span
            className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold tabular-nums ${
              selected === t.id
                ? "bg-indigo-100 dark:bg-indigo-900/40 text-ih-primary"
                : "bg-ih-bg-muted text-ih-fg-3"
            }`}
          >
            {t.count}
          </span>
        </button>
      ))}
    </nav>
  );
}
