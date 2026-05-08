/**
 * Sprint 2 S2-5 — `/inspections/:id/summary` sub-page.
 *
 * Read-only preview of the report. Hits the existing /api/inspections/:id/
 * report endpoint and renders a condensed summary view (defects-only) so
 * inspectors can sanity-check the report before publishing.
 */

import { MainLayout } from '../../layouts/main-layout';
import { InspectionShell } from '../../components/inspection-shell';
import type { BrandingConfig } from '../../../types/auth';

export interface InspectionSummaryPageProps {
    inspectionId:     string;
    propertyAddress:  string;
    branding?:        BrandingConfig | undefined;
    requestId?:       string | undefined;
    siblings?:        Array<{ id: string; templateName: string; status: string }> | undefined;
    enableRepairList?: boolean;
}

export const InspectionSummaryPage = ({
    inspectionId,
    propertyAddress,
    branding,
    requestId,
    siblings,
    enableRepairList,
}: InspectionSummaryPageProps): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout
            title={`${siteName} | Summary`}
            {...(branding ? { branding } : {})}
        >
            <InspectionShell
                inspectionId={inspectionId}
                propertyAddress={propertyAddress}
                current="summary"
                enableRepairList={!!enableRepairList}
                {...(requestId ? { requestId } : {})}
                {...(siblings  ? { siblings  } : {})}
            >
                <div x-data={`inspectionSummaryPage('${inspectionId}')`} x-init="load()" class="space-y-6">
                    <div class="flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <h2 class="text-[18px] font-semibold tracking-tight text-slate-900">Defects summary</h2>
                            <p class="text-[12px] text-slate-500">Read-only preview of the items flagged on this inspection.</p>
                        </div>
                        <a
                            x-bind:href={`'/inspections/${inspectionId}/report'`}
                            class="inline-flex items-center gap-1.5 px-3 h-9 rounded-md bg-white border border-slate-200 text-slate-700 text-[12px] font-bold hover:bg-slate-50 transition-colors"
                        >
                            Edit in report tab
                        </a>
                    </div>

                    <div x-show="loading" class="text-center py-12 text-slate-400 text-[13px]">Loading summary…</div>

                    <div x-show="!loading && stats" style="display:none" class="grid grid-cols-3 gap-3">
                        <div class="rounded-md border border-rose-200 bg-rose-50 px-4 py-3">
                            <div class="text-[10px] font-bold uppercase tracking-[0.2em] text-rose-600">Safety</div>
                            <div class="text-[22px] font-bold text-rose-700 tabular-nums" x-text="stats?.safety || 0"></div>
                        </div>
                        <div class="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                            <div class="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-600">Recommend</div>
                            <div class="text-[22px] font-bold text-amber-700 tabular-nums" x-text="stats?.recommendation || 0"></div>
                        </div>
                        <div class="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                            <div class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600">Maintenance</div>
                            <div class="text-[22px] font-bold text-slate-700 tabular-nums" x-text="stats?.maintenance || 0"></div>
                        </div>
                    </div>

                    <div x-show="!loading && totalDefects === 0" style="display:none" class="text-center py-12 px-6 rounded-lg bg-emerald-50 border border-emerald-200">
                        <p class="text-[13px] text-emerald-700 font-semibold">No defects flagged. The report looks clean.</p>
                    </div>

                    <template x-for="sec in sectionsWithDefects" {...{ 'x-bind:key': 'sec.id' }}>
                        <section class="space-y-3">
                            <header class="flex items-baseline justify-between border-b border-slate-200 pb-2">
                                <h3 class="text-[14px] font-bold text-slate-900" x-text="sec.title"></h3>
                                <span class="text-[11px] text-slate-400 font-mono" x-text="sec.defectCount + ' defects'"></span>
                            </header>
                            <ul class="space-y-2">
                                <template x-for="defect in sec.defects" {...{ 'x-bind:key': 'defect.id' }}>
                                    <li class="rounded-md bg-white border border-slate-200 px-4 py-3 flex items-start gap-3">
                                        <span
                                            class="w-2 h-2 mt-1.5 rounded-full flex-shrink-0"
                                            {...{ 'x-bind:style': "'background:' + (defect.color || '#cbd5e1')" }}
                                        ></span>
                                        <div class="flex-1 min-w-0">
                                            <p class="text-[13px] font-bold text-slate-900" x-text="defect.itemLabel"></p>
                                            <p class="text-[12px] text-slate-600 mt-0.5" x-text="defect.text"></p>
                                        </div>
                                        <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500" x-text="defect.bucket"></span>
                                    </li>
                                </template>
                            </ul>
                        </section>
                    </template>
                </div>
            </InspectionShell>
            <script src="/js/auth.js"></script>
            <script src="/js/inspection-summary.js"></script>
        </MainLayout>
    );
};
