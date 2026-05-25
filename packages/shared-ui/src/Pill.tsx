import React from "react";

type PillTone = "sat" | "monitor" | "defect" | "ni" | "np" | "info" | "gen";

const toneClasses: Record<PillTone, string> = {
  sat: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  monitor: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  defect: "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400",
  ni: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400",
  np: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-500",
  info: "bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-400",
  gen: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400",
};

interface PillProps {
  tone?: PillTone;
  dot?: boolean;
  children: React.ReactNode;
}

export function Pill({ tone = "gen", dot = false, children }: PillProps) {
  return (
    <span className={`inline-flex items-center h-6 px-2 rounded text-[11px] font-bold uppercase tracking-[0.04em] ${toneClasses[tone]}`}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 mr-1.5" />}
      {children}
    </span>
  );
}
