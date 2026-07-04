import React from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-ih-primary text-ih-fg-inverse hover:bg-ih-primary-600 shadow-[var(--shadow-ih-focus)] shadow-transparent hover:shadow-ih-card",
  secondary: "bg-ih-bg-card border border-ih-border text-ih-fg-2 hover:bg-ih-bg-muted",
  ghost: "text-ih-fg-2 hover:bg-ih-bg-muted",
  danger: "bg-ih-bad text-ih-fg-inverse hover:opacity-90",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-4 text-[13px] gap-2",
  lg: "h-11 px-5 text-sm gap-2",
};

export function Button({ variant = "secondary", size = "md", icon, children, className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center font-bold rounded-ih-button transition-all focus:outline-none focus:shadow-ih-focus disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
