/**
 * Sprint 1 Sub-spec D Task 2 (D-2) — Report viewer tab bar.
 *
 * Three tabs: Full Report / Summary (defects only) / Safety Hazard. Filtering
 * is performed both server-side (`filterSectionsByTab`) for SSR + tests, and
 * client-side at print-time via `html[data-viewer-tab="..."]` selectors in
 * `styles.css`. Pure server-rendered tabs; Alpine binds `currentTab` for
 * highlight + active-state.
 */

export type ReportTab = 'full' | 'summary' | 'safety';

export interface ReportTabSectionItem {
    id:       string;
    label:    string;
    rating:   string;
    defects:  { safety: number; recommendation: number; maintenance: number };
    notes:    string;
}

export interface ReportTabSection {
    id:    string;
    title: string;
    items: ReportTabSectionItem[];
}

export function filterSectionsByTab(sections: ReportTabSection[], tab: ReportTab): ReportTabSection[] {
    if (tab === 'full') return sections;
    return sections
        .map((s) => ({
            ...s,
            items: s.items.filter((i) => {
                if (tab === 'summary') return (i.defects.safety + i.defects.recommendation + i.defects.maintenance) > 0;
                if (tab === 'safety')  return i.defects.safety > 0;
                return true;
            }),
        }))
        .filter((s) => s.items.length > 0);
}

export interface ReportTabBarProps {
    defectCounts: { safety: number; recommendation: number; maintenance: number };
}

export const ReportTabBar = ({ defectCounts }: ReportTabBarProps): JSX.Element => {
    const totalDefects = defectCounts.safety + defectCounts.recommendation + defectCounts.maintenance;
    return (
        <div class="flex items-center gap-1 border-b border-slate-200 bg-white sticky top-0 z-20 print:hidden" role="tablist" aria-label="Report view">
            <button
                type="button"
                role="tab"
                x-bind:aria-selected="currentTab === 'full'"
                x-on:click="switchTab('full')"
                x-bind:class="currentTab === 'full' ? 'border-b-2 border-indigo-500 text-slate-900' : 'border-b-2 border-transparent text-slate-500 hover:text-slate-900'"
                class="px-4 py-3 text-[13px] font-bold transition-colors focus:outline-none focus:bg-slate-50"
            >
                Full Report
            </button>
            <button
                type="button"
                role="tab"
                x-bind:aria-selected="currentTab === 'summary'"
                x-on:click="switchTab('summary')"
                x-bind:class="currentTab === 'summary' ? 'border-b-2 border-indigo-500 text-slate-900' : 'border-b-2 border-transparent text-slate-500 hover:text-slate-900'"
                class="px-4 py-3 text-[13px] font-bold transition-colors focus:outline-none focus:bg-slate-50 inline-flex items-center gap-1.5"
            >
                Summary
                <span class="ih-pill ih-pill--monitor">{totalDefects}</span>
            </button>
            <button
                type="button"
                role="tab"
                x-bind:aria-selected="currentTab === 'safety'"
                x-on:click="switchTab('safety')"
                x-bind:class="currentTab === 'safety' ? 'border-b-2 border-rose-500 text-slate-900' : 'border-b-2 border-transparent text-slate-500 hover:text-slate-900'"
                class="px-4 py-3 text-[13px] font-bold transition-colors focus:outline-none focus:bg-slate-50 inline-flex items-center gap-1.5"
            >
                Safety Hazard
                {defectCounts.safety > 0 && <span class="ih-pill ih-pill--defect">{defectCounts.safety}</span>}
            </button>
        </div>
    );
};
