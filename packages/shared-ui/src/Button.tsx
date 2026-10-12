import React from "react";
import { cn } from "./cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link" | "danger-link";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  selected?: boolean;
  /**
   * Async work in flight. Renders `aria-disabled` rather than native `disabled`, so a focused
   * button keeps focus (a natively disabled one drops it to <body>, and a dialog opened by the
   * work would then record <body> as its focus-return target). Clicks are swallowed.
   * Native `disabled` still wins when both are given.
   */
  pending?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-ih-primary text-ih-fg-inverse hover:bg-ih-primary-600 shadow-[var(--shadow-ih-focus)] shadow-transparent hover:shadow-ih-card aria-disabled:hover:bg-ih-primary aria-disabled:hover:shadow-[var(--shadow-ih-focus)] aria-disabled:hover:shadow-transparent",
  secondary: "bg-ih-bg-card border border-ih-border text-ih-fg-2 hover:bg-ih-bg-muted aria-disabled:hover:bg-ih-bg-card",
  ghost: "text-ih-fg-2 hover:bg-ih-bg-muted aria-disabled:hover:bg-transparent",
  danger: "bg-ih-bad text-ih-fg-inverse hover:opacity-90 aria-disabled:hover:opacity-50",
  link: "text-ih-primary-text hover:underline bg-transparent aria-disabled:hover:no-underline",
  "danger-link": "text-ih-bad-fg hover:underline bg-transparent aria-disabled:hover:no-underline",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-4 text-[13px] gap-2",
  lg: "h-11 px-5 text-sm gap-2",
};

/**
 * The button's visual recipe, for the cases where the control has to be a real
 * `<a>`: a card action that navigates is a link — it must right-click,
 * middle-click and open in a new tab — but it should not therefore *look* like
 * a different rank of control than the buttons beside it. Hand-copying these
 * classes into an anchor is how a page ends up with three weights for one rank.
 */
export function buttonClasses({
  variant = "secondary",
  size = "md",
  className = "",
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return cn(
    "inline-flex items-center justify-center font-bold rounded-ih-button transition-all focus:outline-none focus:shadow-ih-focus disabled:opacity-50 disabled:cursor-not-allowed",
    variantClasses[variant],
    sizeClasses[size],
    className,
  );
}

// Pending clicks must neither reach the caller nor submit an enclosing form.
function swallowClick(e: React.MouseEvent<HTMLButtonElement>) {
  e.preventDefault();
}

/** Look of a pending control; pair it with `pendingProps` on a raw element. */
export const PENDING_CLASS = "aria-disabled:opacity-50 aria-disabled:cursor-not-allowed";

/**
 * The same pending semantics as `<Button pending>` for a raw `<button>` that cannot be the
 * shared Button: aria-disabled instead of native `disabled` (a focused button that becomes
 * disabled drops focus to <body>) and a click that reaches neither the caller nor a form.
 */
export function pendingProps<T extends HTMLElement>(
  pending: boolean | undefined,
  onClick?: React.MouseEventHandler<T>,
): { "aria-disabled": true | undefined; onClick: React.MouseEventHandler<T> | undefined } {
  return {
    "aria-disabled": pending ? true : undefined,
    onClick: pending ? (e: React.MouseEvent<T>) => e.preventDefault() : onClick,
  };
}

// React 19: `ref` is a plain prop, so no forwardRef wrapper.
export function Button({
  variant = "secondary", size = "md", icon, children, className = "", selected, pending, onClick, ref, ...props
}: ButtonProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const selectedClass = selected ? "ring-2 ring-ih-primary ring-inset" : "";
  return (
    <button
      type="button"
      ref={ref}
      aria-pressed={selected === undefined ? undefined : selected}
      aria-disabled={pending ? true : undefined}
      className={cn(
        "inline-flex items-center justify-center font-bold rounded-ih-button transition-all focus:outline-none focus:shadow-ih-focus disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed",
        variantClasses[variant],
        sizeClasses[size],
        selectedClass,
        className,
      )}
      {...props}
      onClick={pending ? swallowClick : onClick}
    >
      {icon}
      {children}
    </button>
  );
}
