import React, { useId, useRef } from "react";
import { useDialogBehavior } from "./useDialogBehavior";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: "sm" | "md" | "lg" | "xl";
  children: React.ReactNode;
  footer?: React.ReactNode;
  /**
   * Element to receive initial focus on open (e.g. a search/text input).
   * Without it the first focusable — the header close button — is focused.
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

const sizeClasses = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-xl" };

export function Modal({ open, onClose, title, size = "md", children, footer, initialFocusRef }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useDialogBehavior(open, onClose, ref, initialFocusRef);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-ih-backdrop"
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
        className={`w-full ${sizeClasses[size]} bg-ih-bg-card rounded-t-ih-modal sm:rounded-ih-modal shadow-ih-popover border border-ih-border max-h-[90vh] overflow-y-auto`}
      >
        <div className="flex items-center justify-between p-4 border-b border-ih-border">
          <h2 id={titleId} className="text-lg font-bold text-ih-fg-1">
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
        <div className="p-4">{children}</div>
        {footer && <div className="flex justify-end gap-3 p-4 border-t border-ih-border">{footer}</div>}
      </div>
    </div>
  );
}
