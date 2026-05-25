import React from "react";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 px-6 text-center">
      {icon && <div className="w-12 h-12 text-slate-300 dark:text-slate-600">{icon}</div>}
      <h3 className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">{title}</h3>
      {description && <p className="text-[12px] text-slate-500 max-w-[32ch]">{description}</p>}
      {action}
    </div>
  );
}
