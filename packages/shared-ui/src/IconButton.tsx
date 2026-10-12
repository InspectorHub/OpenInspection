import React from "react";
import { cn } from "./cn";
import { pendingProps, PENDING_CLASS } from "./Button";

type IconButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type IconButtonSize = "sm" | "md" | "lg";

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required accessible name — icon-only buttons have no text. */
  "aria-label": string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  selected?: boolean;
  /** Busy: aria-disabled with an inert click, so a focused button keeps focus (see Button `pending`). */
  pending?: boolean;
}

const variantClasses: Record<IconButtonVariant, string> = {
  primary: "bg-ih-primary text-ih-fg-inverse hover:bg-ih-primary-600 aria-disabled:hover:bg-ih-primary",
  secondary: "bg-ih-bg-card border border-ih-border text-ih-fg-2 hover:bg-ih-bg-muted aria-disabled:hover:bg-ih-bg-card",
  ghost: "text-ih-fg-2 hover:bg-ih-bg-muted aria-disabled:hover:bg-transparent",
  danger: "bg-ih-bad text-ih-fg-inverse hover:opacity-90 aria-disabled:hover:opacity-50",
};

const sizeClasses: Record<IconButtonSize, string> = {
  sm: "w-7 h-7",
  md: "w-9 h-9",
  lg: "w-11 h-11",
};

// React 19: `ref` is a plain prop, so no forwardRef wrapper.
export function IconButton({
  variant = "ghost", size = "md", selected, pending, onClick, "aria-disabled": ariaDisabled, className = "", children, ref, ...props
}: IconButtonProps & { ref?: React.Ref<HTMLButtonElement> }) {
    const selectedClass = selected ? "ring-2 ring-ih-primary ring-inset text-ih-primary-text" : "";
    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={selected === undefined ? undefined : selected}
        className={cn(
          "inline-flex items-center justify-center rounded-ih-button transition-all focus:outline-none focus:shadow-ih-focus disabled:opacity-50 disabled:cursor-not-allowed",
          PENDING_CLASS,
          variantClasses[variant],
          sizeClasses[size],
          selectedClass,
          className,
        )}
        {...props}
        aria-disabled={pending ? true : ariaDisabled}
        onClick={pendingProps(pending, onClick).onClick}
      >
        {children}
      </button>
    );
}
