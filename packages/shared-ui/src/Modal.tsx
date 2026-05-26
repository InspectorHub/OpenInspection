import React, { useEffect, useRef } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: "sm" | "md" | "lg" | "xl";
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const sizeClasses = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-xl" };

export function Modal({ open, onClose, title, size = "md", children, footer }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(15,23,42,0.55)]" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`w-full ${sizeClasses[size]} bg-ih-bg-card rounded-xl shadow-ih-popover border border-ih-border max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between p-4 border-b border-ih-border">
          <h2 className="text-lg font-bold text-ih-fg-1">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-md text-ih-fg-4 hover:text-ih-fg-2">&#x2715;</button>
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="flex justify-end gap-3 p-4 border-t border-ih-border">{footer}</div>}
      </div>
    </div>
  );
}
