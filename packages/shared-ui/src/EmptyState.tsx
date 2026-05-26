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
      {icon && <div className="w-12 h-12 text-ih-fg-5">{icon}</div>}
      <h3 className="text-[14px] font-bold text-ih-fg-2">{title}</h3>
      {description && <p className="text-[11px] text-ih-fg-3 max-w-[32ch]">{description}</p>}
      {action}
    </div>
  );
}
