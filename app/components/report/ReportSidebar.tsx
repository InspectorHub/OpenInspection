import { useState } from "react";

export interface ReportSidebarSection {
  id: string;
  title: string;
  icon?: string;
  defects: { safety: number; recommendation: number; maintenance: number };
}

interface ReportSidebarProps {
  sections: ReportSidebarSection[];
  role: "inspector" | "agent" | "client";
  inspectionId: string;
  brandLogo?: string;
  siteName: string;
  onPublish?: () => void;
}

export function ReportSidebar({ sections, role, inspectionId, brandLogo, siteName, onPublish }: ReportSidebarProps) {
  const [activeSection, setActiveSection] = useState<string | null>(null);

  return (
    <aside className="lg:fixed lg:top-0 lg:left-0 lg:bottom-0 lg:w-60 bg-slate-900 text-slate-200 flex flex-col z-30 print:hidden hidden lg:flex" aria-label="Report navigation">
      <div className="px-5 py-5 border-b border-slate-800">
        {brandLogo
          ? <img src={brandLogo} alt={siteName} className="h-7 brightness-0 invert opacity-90" />
          : <div className="text-[15px] font-bold tracking-tight text-white">{siteName}</div>}
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mt-2">Inspection Report</p>
      </div>

      {role === "inspector" && (
        <div className="px-5 py-3 border-b border-slate-800 space-y-2">
          <a href={`/inspections/${inspectionId}/edit`} className="block w-full h-9 px-3 rounded-md bg-ih-primary text-white text-[12px] font-bold inline-flex items-center justify-center gap-1.5 hover:bg-ih-primary-600 transition-colors focus:outline-none focus:ring-2 focus:ring-white/30">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
            Edit Report
          </a>
          <button type="button" onClick={onPublish} className="block w-full h-9 px-3 rounded-md bg-ih-watch-bg0 text-amber-950 text-[12px] font-bold hover:bg-amber-400 transition-colors focus:outline-none focus:ring-2 focus:ring-white/30">
            Publish
          </button>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto py-2" aria-label="Report sections">
        {sections.map((s) => {
          const total = s.defects.safety + s.defects.recommendation + s.defects.maintenance;
          const isActive = activeSection === s.id;
          return (
            <a key={s.id} href={`#section-${s.id}`} onClick={() => setActiveSection(s.id)} className={`group flex items-center gap-2 px-5 py-2 text-[13px] font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors focus:outline-none focus:bg-slate-800 focus:text-white ${isActive ? "bg-slate-800 text-white border-l-2 border-indigo-400 -ml-0.5" : ""}`}>
              {s.icon && (
                <svg className="w-3.5 h-3.5 flex-shrink-0 opacity-60 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={s.icon} /></svg>
              )}
              <span className="flex-1 truncate">{s.title}</span>
              {total > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-ih-bad-bg0 text-white text-[10px] font-bold tabular-nums" title={`${total} issue${total === 1 ? "" : "s"} in this section`} aria-label={`${total} issues`}>{total}</span>
              )}
            </a>
          );
        })}
      </nav>

      <div className="px-5 py-3 border-t border-slate-800 text-[11px] text-ih-fg-3 space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
          <span>Live</span>
        </div>
      </div>
    </aside>
  );
}
