import React from "react";
import { cn } from "./cn";

interface MenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  tone?: "default" | "danger";
}

export const MenuItem = React.forwardRef<HTMLButtonElement, MenuItemProps>(
  function MenuItem({ icon, tone = "default", className = "", children, ...props }, ref) {
    const toneClass = tone === "danger" ? "text-ih-bad-fg" : "text-ih-fg-2";
    return (
      <button
        ref={ref}
        type="button"
        role="menuitem"
        className={cn(
          "w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2 hover:bg-ih-bg-muted disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:bg-ih-bg-muted",
          toneClass,
          className,
        )}
        {...props}
      >
        {icon != null && <span className="shrink-0" aria-hidden="true">{icon}</span>}
        {children}
      </button>
    );
  },
);
