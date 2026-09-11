import React from "react";

export type PillTone = "sat" | "monitor" | "defect" | "ni" | "np" | "info" | "gen" | "primary" | "neutral" | "warning";

/**
 * IA-88 ④ — `monitor` and `warning` used to map to the same two tokens.
 *
 * They are not the same thing. `monitor` is a RATING: the "Monitor" level of
 * the shipped rating systems (severity `marginal`, amber), which is also the
 * colour the report gives it. `warning` is a WORKFLOW flag — "Not sent",
 * "Not invoiced", "Expired", "Partially paid". The hub's Invoice card shows
 * one of each, and they came out as the same orange chip.
 *
 * There is no second amber to move `warning` to: the palette has four status
 * hues (ok / watch / bad / info) and the rating vocabulary already owns
 * ok + watch + bad. So `warning` keeps the attention hue and changes FORM —
 * a hollow ringed chip against the rating's filled one. `ring-1 ring-inset`
 * rather than `border`, so a row mixing the two keeps one chip height.
 */
const toneClasses: Record<PillTone, string> = {
  sat: "bg-ih-ok-bg text-ih-ok-fg",
  monitor: "bg-ih-watch-bg text-ih-watch-fg",
  defect: "bg-ih-bad-bg text-ih-bad-fg",
  ni: "bg-ih-bg-muted text-ih-fg-3",
  np: "bg-ih-bg-muted text-ih-fg-4",
  info: "bg-ih-info-bg text-ih-info-fg",
  gen: "bg-ih-bg-muted text-ih-fg-3",
  primary: "bg-ih-primary-tint text-ih-primary-text",
  neutral: "bg-ih-bg-muted text-ih-fg-3",
  warning: "bg-transparent text-ih-watch-fg ring-1 ring-inset ring-ih-watch",
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
