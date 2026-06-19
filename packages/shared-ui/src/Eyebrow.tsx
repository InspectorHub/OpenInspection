/** @deprecated See the 2026-06-18 eyebrow deprecation. Detail/hierarchy pages now use a breadcrumb + a status Pill in PageHeader `meta`. Component retained for backward compatibility; evaluate removal once all pages have migrated. */
import React from "react";

export type EyebrowColor = "slate" | "indigo" | "emerald" | "amber" | "rose";

const colorClasses: Record<EyebrowColor, string> = {
  slate: "bg-ih-bg-muted text-ih-fg-3",
  indigo: "bg-ih-primary-tint text-ih-primary",
  emerald: "bg-ih-ok-bg text-ih-ok-fg",
  amber: "bg-ih-watch-bg text-ih-watch-fg",
  rose: "bg-ih-bad-bg text-ih-bad-fg",
};

interface EyebrowProps {
  color?: EyebrowColor;
  children: React.ReactNode;
}

export function Eyebrow({ color = "slate", children }: EyebrowProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md ih-eyebrow ${colorClasses[color]}`}>
      <span className="w-1 h-1 rounded-full bg-current opacity-60" />
      {children}
    </span>
  );
}
