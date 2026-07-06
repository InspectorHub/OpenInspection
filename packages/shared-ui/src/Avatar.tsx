import React from "react";

export type AvatarSize = 28 | 32 | 36;
export type AvatarVariant = "flat" | "self";
export type AvatarStatus = "online" | "offline";

interface AvatarProps {
  /** Full name; initials are derived from it. */
  name: string;
  /** Rendered pixel dimensions (28/32/36). Defaults to 32. */
  size?: AvatarSize;
  /** `self` = gradient (current user); `flat` = muted (other people). Defaults to flat. */
  variant?: AvatarVariant;
  /** Presence indicator dot. `true` is treated as online. */
  statusDot?: boolean | AvatarStatus;
  /** Inset ring border. */
  ring?: boolean;
  /** Shown when `name` is empty. */
  fallbackIcon?: React.ReactNode;
  className?: string;
}

/**
 * Consolidated initials logic (was duplicated across TeamStrip, TeamCredit,
 * IdentitySwitcher, session-context, PeopleCard, inspectors). Multi-word names
 * use the first letter of the first two words; single-word names use the first
 * two characters. Empty names yield an empty string (caller shows a fallback).
 */
export function avatarInitials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const sizeClasses: Record<AvatarSize, { box: string; font: string }> = {
  28: { box: "w-7 h-7", font: "text-[11px]" },
  32: { box: "w-8 h-8", font: "text-[12px]" },
  36: { box: "w-9 h-9", font: "text-xs" },
};

const variantClasses: Record<AvatarVariant, string> = {
  self: "bg-gradient-to-br from-ih-primary to-ih-primary-700 text-ih-fg-inverse",
  flat: "bg-ih-bg-muted text-ih-fg-2",
};

function statusColor(statusDot: boolean | AvatarStatus): string {
  if (statusDot === "offline") return "bg-ih-fg-4";
  // true or "online"
  return "bg-ih-ok";
}

export function Avatar({
  name,
  size = 32,
  variant = "flat",
  statusDot = false,
  ring = false,
  fallbackIcon,
  className = "",
}: AvatarProps) {
  const { box, font } = sizeClasses[size];
  const initials = avatarInitials(name);
  const ringClass = ring ? " ring-1 ring-inset ring-ih-border" : "";

  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      <span
        role="img"
        aria-label={name || undefined}
        className={`${box} ${font} rounded-full flex items-center justify-center font-bold ${variantClasses[variant]}${ringClass}`}
      >
        {initials || fallbackIcon}
      </span>
      {statusDot !== false && (
        <span
          data-avatar-status
          aria-hidden="true"
          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-ih-bg-card ${statusColor(statusDot)}`}
        />
      )}
    </span>
  );
}
