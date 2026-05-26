import { useState, useRef, useEffect } from "react";

interface PdfDropdownProps {
  onPrintAs?: (mode: "full" | "summary" | "safety") => void;
}

export function PdfDropdown({ onPrintAs }: PdfDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function print(mode: "full" | "summary" | "safety") {
    onPrintAs?.(mode);
    setOpen(false);
  }

  return (
    <div className="relative print:hidden" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="h-9 px-3 rounded-md bg-ih-primary text-white text-[13px] font-bold inline-flex items-center gap-1.5 hover:bg-ih-primary-600 transition-colors focus:outline-none focus:shadow-ih-focus"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
        PDF
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 rounded-md bg-ih-bg-card border border-ih-border shadow-lg overflow-hidden z-10" role="menu">
          <button type="button" onClick={() => print("full")} role="menuitem" className="block w-full px-4 py-2.5 text-left hover:bg-ih-bg-muted transition-colors">
            <div className="text-[13px] font-bold text-ih-fg-1">Print Full Report</div>
            <div className="text-[11px] text-ih-fg-3 mt-0.5">All sections, items, photos</div>
          </button>
          <button type="button" onClick={() => print("summary")} role="menuitem" className="block w-full px-4 py-2.5 text-left hover:bg-ih-bg-muted transition-colors">
            <div className="text-[13px] font-bold text-ih-fg-1">Print Summary</div>
            <div className="text-[11px] text-ih-fg-3 mt-0.5">Only items with defects</div>
          </button>
          <button type="button" onClick={() => print("safety")} role="menuitem" className="block w-full px-4 py-2.5 text-left hover:bg-ih-bg-muted transition-colors">
            <div className="text-[13px] font-bold text-ih-fg-1">Print Safety Hazards</div>
            <div className="text-[11px] text-ih-fg-3 mt-0.5">Only safety category</div>
          </button>
          <div className="border-t border-slate-100 dark:border-slate-700" />
          <p className="px-4 py-2 text-[10px] text-slate-400">
            Tip: select <span className="font-mono">Save as PDF</span> in your browser&apos;s print dialog.
          </p>
        </div>
      )}
    </div>
  );
}
