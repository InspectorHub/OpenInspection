import React from "react";
import { cn } from "./cn";

type IconButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type IconButtonSize = "sm" | "md" | "lg";

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required accessible name — icon-only buttons have no text. */
  "aria-label": string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  selected?: boolean;
}

const variantClasses: Record<IconButtonVariant, string> = {
  primary: "bg-ih-primary text-ih-fg-inverse hover:bg-ih-primary-600",
  secondary: "bg-ih-bg-card border border-ih-border text-ih-fg-2 hover:bg-ih-bg-muted",
  ghost: "text-ih-fg-2 hover:bg-ih-bg-muted",
  danger: "bg-ih-bad text-ih-fg-inverse hover:opacity-90",
};

const sizeClasses: Record<IconButtonSize, string> = {
  sm: "w-7 h-7",
  md: "w-9 h-9",
  lg: "w-11 h-11",
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ variant = "ghost", size = "md", selected, className = "", children, ...props }, ref) {
    const selectedClass = selected ? "ring-2 ring-ih-primary ring-inset text-ih-primary" : "";
    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={selected === undefined ? undefined : selected}
        className={cn(
          "inline-flex items-center justify-center rounded-ih-button transition-all focus:outline-none focus:shadow-ih-focus disabled:opacity-50 disabled:cursor-not-allowed",
          variantClasses[variant],
          sizeClasses[size],
          selectedClass,
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);
