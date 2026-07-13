import React from "react";
import { cn } from "./cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link" | "danger-link";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  selected?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-ih-primary text-ih-fg-inverse hover:bg-ih-primary-600 shadow-[var(--shadow-ih-focus)] shadow-transparent hover:shadow-ih-card",
  secondary: "bg-ih-bg-card border border-ih-border text-ih-fg-2 hover:bg-ih-bg-muted",
  ghost: "text-ih-fg-2 hover:bg-ih-bg-muted",
  danger: "bg-ih-bad text-ih-fg-inverse hover:opacity-90",
  link: "text-ih-primary hover:underline bg-transparent",
  "danger-link": "text-ih-bad-fg hover:underline bg-transparent",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-4 text-[13px] gap-2",
  lg: "h-11 px-5 text-sm gap-2",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, children, className = "", selected, ...props },
  ref,
) {
  const selectedClass = selected ? "ring-2 ring-ih-primary ring-inset" : "";
  return (
    <button
      type="button"
      ref={ref}
      aria-pressed={selected === undefined ? undefined : selected}
      className={cn(
        "inline-flex items-center justify-center font-bold rounded-ih-button transition-all focus:outline-none focus:shadow-ih-focus disabled:opacity-50 disabled:cursor-not-allowed",
        variantClasses[variant],
        sizeClasses[size],
        selectedClass,
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
});
