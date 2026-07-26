import React from "react";
import { cn } from "./cn";

interface MenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  tone?: "default" | "danger";
}

// React 19: `ref` is a plain prop, so no forwardRef wrapper.
export function MenuItem({
  icon, tone = "default", className = "", children, ref, ...props
}: MenuItemProps & { ref?: React.Ref<HTMLButtonElement> }) {
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
}
