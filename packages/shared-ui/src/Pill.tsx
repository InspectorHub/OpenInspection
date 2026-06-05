import React from "react";

type PillTone = "sat" | "monitor" | "defect" | "ni" | "np" | "info" | "gen" | "primary" | "neutral" | "warning";

const toneClasses: Record<PillTone, string> = {
  sat: "bg-ih-ok-bg text-ih-ok-fg",
  monitor: "bg-ih-watch-bg text-ih-watch-fg",
  defect: "bg-ih-bad-bg text-ih-bad-fg",
  ni: "bg-ih-bg-muted text-ih-fg-3",
  np: "bg-ih-bg-muted text-ih-fg-4",
  info: "bg-ih-info-bg text-ih-info-fg",
  gen: "bg-ih-bg-muted text-ih-fg-3",
  primary: "bg-ih-primary-tint text-ih-primary",
  neutral: "bg-ih-bg-muted text-ih-fg-3",
  warning: "bg-ih-watch-bg text-ih-watch-fg",
};

interface PillProps {
  tone?: PillTone;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Pill({ tone = "gen", dot = false, children, className = "" }: PillProps) {
  return (
    <span className={`ih-pill ${toneClasses[tone]} ${className}`}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />}
      {children}
    </span>
  );
}
