import { useState, useRef, useEffect, useCallback } from "react";

interface InlineTextPopoverProps {
  open: boolean;
  title?: string;
  placeholder?: string;
  initialValue?: string;
  templates?: string[];
  onApply?: (value: string) => void;
  onClose?: () => void;
}

export function InlineTextPopover({
  open,
  title = "Edit",
  placeholder = "",
  initialValue = "",
  templates = [],
  onApply,
  onClose,
}: InlineTextPopoverProps) {
  const [value, setValue] = useState(initialValue);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) { setValue(initialValue); setTimeout(() => taRef.current?.focus(), 50); }
  }, [open, initialValue]);

  const apply = useCallback(() => {
    if (value.trim()) onApply?.(value.trim());
  }, [value, onApply]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); apply(); }
  }

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape" && open) { onClose?.(); e.stopPropagation(); }
    }
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="oi-prompt-title">
      <div className="absolute inset-0 bg-[rgba(15,23,42,0.4)] backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-lg bg-ih-bg-card border border-ih-border" style={{ boxShadow: "0 12px 32px rgba(15,23,42,0.12)" }}>
        <div className="px-5 py-4 border-b border-ih-border">
          <h3 id="oi-prompt-title" className="text-[15px] font-semibold text-ih-fg-1 tracking-tight">{title}</h3>
        </div>
        <div className="p-5 space-y-3">
          {templates.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {templates.map((t) => (
                <button key={t} type="button" onClick={() => setValue(t)} className="inline-flex items-center h-6 px-2.5 rounded-full bg-ih-primary-tint text-ih-primary text-[11px] font-bold hover:bg-ih-primary-tint active:scale-95 transition-all focus:outline-none focus:shadow-ih-focus">
                  {t}
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={3}
            aria-label="Edit text"
            className="w-full px-3 py-2 rounded-md border border-ih-border focus:border-ih-primary focus:shadow-ih-focus outline-none text-[13px] font-medium resize-none transition-colors bg-ih-bg-card text-ih-fg-1"
          />
          <p className="text-[11px] text-ih-fg-4 font-medium">
            <kbd className="inline-flex items-center px-1 rounded bg-ih-bg-muted text-ih-fg-3 text-[10px]">&#8984; &crarr;</kbd> apply &middot; <kbd className="inline-flex items-center px-1 rounded bg-ih-bg-muted text-ih-fg-3 text-[10px]">Esc</kbd> cancel
          </p>
        </div>
        <div className="px-5 py-3 flex items-center justify-end gap-2 border-t border-ih-border bg-ih-bg-muted rounded-b-lg">
          <button type="button" onClick={onClose} className="h-8 px-4 rounded-md text-[13px] font-bold text-ih-fg-3 hover:bg-ih-bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ih-border-strong/30">
            Cancel
          </button>
          <button type="button" onClick={apply} disabled={!value.trim()} className="h-8 px-4 rounded-md bg-ih-primary text-white text-[13px] font-bold hover:bg-ih-primary-600 disabled:bg-ih-border-strong disabled:cursor-not-allowed transition-colors focus:outline-none focus:shadow-ih-focus">
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
