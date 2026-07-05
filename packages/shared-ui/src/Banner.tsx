import React from "react";
import { Icon } from "./Icon";

export type BannerTone = "info" | "warn" | "danger" | "success" | "brand";

interface BannerProps {
  tone?: BannerTone;
  /** 1–3 buttons/links rendered on the right (wraps below on mobile). */
  actions?: React.ReactNode;
  /** Render a close affordance that calls onDismiss. */
  dismissible?: boolean;
  onDismiss?: () => void;
  /** Optional leading icon slot. */
  icon?: React.ReactNode;
  /** Page-top sticky variant. */
  sticky?: boolean;
  children: React.ReactNode;
  className?: string;
}

/** Tone → DS token trio (bg / border / text). Mirrors Pill's tone map. */
const toneClasses: Record<BannerTone, string> = {
  info: "bg-ih-info-bg border-ih-info text-ih-info-fg",
  warn: "bg-ih-watch-bg border-ih-watch text-ih-watch-fg",
  danger: "bg-ih-bad-bg border-ih-bad text-ih-bad-fg",
  success: "bg-ih-ok-bg border-ih-ok text-ih-ok-fg",
  brand: "bg-ih-primary-tint border-ih-primary text-ih-primary",
};

/**
 * ARIA live-region role: negative/actionable tones (warn/danger) assert
 * themselves via role="alert"; passive/positive tones (info/success/brand)
 * announce politely via role="status".
 */
const toneRole: Record<BannerTone, "alert" | "status"> = {
  info: "status",
  warn: "alert",
  danger: "alert",
  success: "status",
  brand: "status",
};

export function Banner({
  tone = "info",
  actions,
  dismissible = false,
  onDismiss,
  icon,
  sticky = false,
  children,
  className = "",
}: BannerProps) {
  return (
    <div
      role={toneRole[tone]}
      className={`flex flex-wrap items-center gap-2 px-4 py-3 rounded-ih-card border text-sm font-semibold ${toneClasses[tone]} ${sticky ? "sticky top-0 z-20" : ""} ${className}`}
    >
      {icon && <span className="flex shrink-0 items-center">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      {dismissible && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="ml-1 shrink-0 text-current opacity-60 transition-opacity hover:opacity-100"
        >
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  );
}
