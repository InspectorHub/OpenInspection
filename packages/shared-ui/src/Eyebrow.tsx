import React from "react";

export type EyebrowColor = "slate" | "indigo" | "emerald" | "amber" | "rose";

const colorClasses: Record<EyebrowColor, string> = {
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400",
  indigo: "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400",
  emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  rose: "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400",
};

interface EyebrowProps {
  color?: EyebrowColor;
  children: React.ReactNode;
}

export function Eyebrow({ color = "slate", children }: EyebrowProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-[0.2em] ${colorClasses[color]}`}>
      <span className="w-1 h-1 rounded-full bg-current opacity-60" />
      {children}
    </span>
  );
}
