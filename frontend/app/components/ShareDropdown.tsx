import { useState, useRef, useEffect } from "react";

interface ShareDropdownProps {
  reportUrl: string;
  inspectionId?: string;
  onShareToAgent?: () => void;
}

export function ShareDropdown({ reportUrl, inspectionId, onShareToAgent }: ShareDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function copyLink() {
    navigator.clipboard.writeText(reportUrl);
    setOpen(false);
  }

  function emailLink() {
    window.location.href = `mailto:?subject=Inspection Report&body=${encodeURIComponent(reportUrl)}`;
    setOpen(false);
  }

  async function shareToAgent() {
    if (inspectionId) {
      try {
        await fetch(`/api/inspections/${inspectionId}/share-agent`, {
          method: "POST",
          credentials: "include",
        });
      } catch {
        // degrade gracefully
      }
    }
    onShareToAgent?.();
    setOpen(false);
  }

  return (
    <div className="relative print:hidden" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="h-9 px-3 rounded-md bg-ih-bg-card border border-ih-border text-ih-fg-3 text-[13px] font-bold inline-flex items-center gap-1.5 hover:bg-ih-bg-muted transition-colors focus:outline-none focus:shadow-ih-focus"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
        Share
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-56 rounded-md bg-ih-bg-card border border-ih-border shadow-lg overflow-hidden z-10" role="menu">
          <button type="button" onClick={copyLink} role="menuitem" className="w-full px-4 py-2.5 text-left text-[13px] font-medium text-ih-fg-3 hover:bg-ih-bg-muted flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
            Copy link
          </button>
          <button type="button" onClick={emailLink} role="menuitem" className="w-full px-4 py-2.5 text-left text-[13px] font-medium text-ih-fg-3 hover:bg-ih-bg-muted flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            Email link
          </button>
          <div className="border-t border-slate-100 dark:border-slate-700" />
          <button type="button" onClick={shareToAgent} role="menuitem" className="w-full px-4 py-2.5 text-left text-[13px] font-bold text-indigo-700 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 flex items-center gap-2">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            Share with your agent
          </button>
        </div>
      )}
    </div>
  );
}
