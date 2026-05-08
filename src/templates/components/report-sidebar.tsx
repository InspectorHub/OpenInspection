/**
 * Sprint 1 Sub-spec D Task 1 (D-1) — Report viewer left sidebar.
 *
 * Dark slate-900 navigation panel with section list, defect badges, and
 * inspector-only action buttons (Edit / Publish). Used by the report viewer
 * (`report.template.tsx`). Hidden in print output via `print:hidden`.
 *
 * The sidebar is rendered server-side; section highlight + scroll behavior
 * is wired from `public/js/report-viewer.js` (Alpine `reportViewer` data).
 */

export interface ReportSidebarSection {
    id:        string;
    title:     string;
    icon?:     string;          // SVG path d-attribute (optional)
    defects:   { safety: number; recommendation: number; maintenance: number };
}

export interface ReportSidebarProps {
    sections:    ReportSidebarSection[];
    role:        'inspector' | 'agent' | 'client';
    inspectionId: string;
    brandLogo?:  string;
    siteName:    string;
}

export const ReportSidebar = ({ sections, role, inspectionId, brandLogo, siteName }: ReportSidebarProps): JSX.Element => (
    <aside class="lg:fixed lg:top-0 lg:left-0 lg:bottom-0 lg:w-60 bg-slate-900 text-slate-200 flex flex-col z-30 print:hidden hidden lg:flex" aria-label="Report navigation">
        <div class="px-5 py-5 border-b border-slate-800">
            {brandLogo
                ? <img src={brandLogo} alt={siteName} class="h-7 brightness-0 invert opacity-90" />
                : <div class="text-[15px] font-bold tracking-tight text-white">{siteName}</div>}
            <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mt-2">Inspection Report</p>
        </div>

        {/* Inspector-only actions */}
        {role === 'inspector' && (
            <div class="px-5 py-3 border-b border-slate-800 space-y-2">
                <a
                    href={`/inspections/${inspectionId}/edit`}
                    class="block w-full h-9 px-3 rounded-md bg-indigo-600 text-white text-[12px] font-bold inline-flex items-center justify-center gap-1.5 hover:bg-indigo-700 transition-colors focus:outline-none focus:ring-2 focus:ring-white/30"
                >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                    Edit Report
                </a>
                <button
                    type="button"
                    x-on:click="openPublish()"
                    class="block w-full h-9 px-3 rounded-md bg-amber-500 text-amber-950 text-[12px] font-bold hover:bg-amber-400 transition-colors focus:outline-none focus:ring-2 focus:ring-white/30"
                >
                    Publish
                </button>
            </div>
        )}

        {/* Sections nav */}
        <nav class="flex-1 overflow-y-auto py-2" aria-label="Report sections">
            {sections.map((s) => {
                const total = s.defects.safety + s.defects.recommendation + s.defects.maintenance;
                return (
                <a
                    href={`#section-${s.id}`}
                    key={s.id}
                    class="group flex items-center gap-2 px-5 py-2 text-[13px] font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors focus:outline-none focus:bg-slate-800 focus:text-white"
                    x-bind:class={`activeSection === '${s.id}' ? 'bg-slate-800 text-white border-l-2 border-indigo-400 -ml-0.5' : ''`}
                >
                    {s.icon && (
                        <svg class="w-3.5 h-3.5 flex-shrink-0 opacity-60 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={s.icon}></path></svg>
                    )}
                    <span class="flex-1 truncate">{s.title}</span>
                    {/*
                      Competitor parity C2 — single red total-defects badge
                      per Spectora App.F.2 ("count of defects in that section").
                      Sums safety + recommendation + maintenance. Only renders
                      when total > 0. The per-category breakdown below stays
                      as the secondary signal so inspectors don't lose the
                      severity split.
                    */}
                    {total > 0 && (
                        <span
                            data-test="section-defect-total"
                            class="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-bold tabular-nums"
                            title={`${total} issue${total === 1 ? '' : 's'} in this section`}
                            aria-label={`${total} issues`}
                        >{total}</span>
                    )}
                    {/* Per-category breakdown — only render non-zero. Wrapped
                        in `hidden lg:flex` so on smaller side-rail widths the
                        single combined badge above stands alone. */}
                    <span class="hidden xl:flex items-center gap-0.5 text-[10px] font-bold tabular-nums">
                        {s.defects.safety > 0 && (
                            <span class="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white" title="Safety hazards">{s.defects.safety}</span>
                        )}
                        {s.defects.recommendation > 0 && (
                            <span class="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-amber-950" title="Recommendations">{s.defects.recommendation}</span>
                        )}
                        {s.defects.maintenance > 0 && (
                            <span class="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-sky-500 text-white" title="Maintenance">{s.defects.maintenance}</span>
                        )}
                    </span>
                </a>
                );
            })}
        </nav>

        {/* Footer status */}
        <div class="px-5 py-3 border-t border-slate-800 text-[11px] text-slate-500 space-y-1">
            <div class="flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true"></span>
                <span>Live</span>
            </div>
        </div>
    </aside>
);
