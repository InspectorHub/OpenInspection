import React, { useId, useRef } from "react";
import { useDialogBehavior } from "./useDialogBehavior";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** 480px panel for dense forms; default is 360px. Mobile is always full-width. */
  wide?: boolean;
}

/**
 * Right-side desktop drawer. Use for "adjust while seeing the page"
 * flows (filters, long side forms) — NOT for confirm/decision moments,
 * which stay in Modal. Reuses Modal's dialog chrome behavior and tokens.
 */
export function Drawer({ open, onClose, title, children, footer, wide = false }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useDialogBehavior(open, onClose, ref);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-ih-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`absolute inset-y-0 right-0 w-full ${wide ? "sm:w-[480px]" : "sm:w-[360px]"} bg-ih-bg-card border-l border-ih-border shadow-ih-popover flex flex-col animate-ih-slide-in-right`}
      >
        <div className="flex items-center justify-between p-4 border-b border-ih-border">
          <h2 id={titleId} className="text-[15px] font-bold text-ih-fg-1">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-ih-button text-ih-fg-4 hover:text-ih-fg-2"
          >
            &#x2715;
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-3 p-4 border-t border-ih-border">{footer}</div>}
      </div>
    </div>
  );
}
