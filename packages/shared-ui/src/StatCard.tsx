import React from "react";
import type { PillTone } from "./Pill";

/**
 * Tone → left-accent border + label color. Reuses the exact same PillTone
 * palette family as the Pill primitive (ok / watch / bad / info / primary /
 * muted-fg), so a StatCard's accent always matches the Pill of the same tone.
 * The border color utility applies to all sides, but only the left side has a
 * width (`border-l-4`), so it renders as a left accent bar.
 */
const toneAccent: Record<PillTone, { border: string; label: string }> = {
  sat: { border: "border-ih-ok", label: "text-ih-ok-fg" },
  monitor: { border: "border-ih-watch", label: "text-ih-watch-fg" },
  defect: { border: "border-ih-bad", label: "text-ih-bad-fg" },
  ni: { border: "border-ih-border-strong", label: "text-ih-fg-3" },
  np: { border: "border-ih-border-strong", label: "text-ih-fg-4" },
  info: { border: "border-ih-info", label: "text-ih-info-fg" },
  gen: { border: "border-ih-border-strong", label: "text-ih-fg-3" },
  primary: { border: "border-ih-primary", label: "text-ih-primary" },
  neutral: { border: "border-ih-border-strong", label: "text-ih-fg-3" },
  warning: { border: "border-ih-watch", label: "text-ih-watch-fg" },
};

interface StatCardProps {
  /** Small muted uppercase caption. */
  label: React.ReactNode;
  /** Large number / text. */
  value: React.ReactNode;
  /** When set, renders a left-accent-border variant in the tone color. */
  tone?: PillTone;
  /** Optional sub-line beneath the value. */
  hint?: React.ReactNode;
  className?: string;
}

export function StatCard({ label, value, tone, hint, className = "" }: StatCardProps) {
  const accent = tone ? toneAccent[tone] : null;
  return (
    <div
      className={`bg-ih-bg-card rounded-ih-card p-ih-card ${
        accent ? `border-l-4 ${accent.border}` : "border border-ih-border"
      } ${className}`}
    >
      <div className={`text-[10px] font-bold uppercase tracking-widest ${accent ? accent.label : "text-ih-fg-3"}`}>
        {label}
      </div>
      <div className="text-xl font-bold mt-1 text-ih-fg-1">{value}</div>
      {hint != null && <div className="text-[11px] text-ih-fg-3 mt-0.5">{hint}</div>}
    </div>
  );
}
