/**
 * Track E1 (ITB §11, UC-ITB-07) — `/inspections/:id/repair-list` sub-page.
 *
 * Server-rendered punch-list of every defect-rated item across the
 * inspection. Distinct from the narrative report — this is what realtors
 * hand to contractors. Renders cleanly under print (`window.print()`),
 * with each defect as a card grouped by section.
 *
 * Reaches the data via the authenticated InspectionService.getRepairList()
 * directly at render time — no client-side fetch needed for the static
 * print-friendly layout.
 */

import { MainLayout } from '../../layouts/main-layout';
import { InspectionShell } from '../../components/inspection-shell';
import type { BrandingConfig } from '../../../types/auth';

export interface RepairListEntry {
    sectionId:           string;
    sectionTitle:        string;
    itemId:              string;
    itemLabel:           string;
    comment:             string;
    location:            string | null;
    category:            'safety' | 'recommendation' | 'maintenance';
    recommendationId:    string | null;
    recommendationLabel: string | null;
    estimateLow:         number | null;
    estimateHigh:        number | null;
    photos:              Array<{ key: string; url: string }>;
    source:              'canned' | 'custom';
}

export interface RepairListPageProps {
    inspectionId:    string;
    propertyAddress: string;
    inspectionDate:  string | null;
    inspectorName:   string | null;
    defects:         RepairListEntry[];
    totals: {
        count:           number;
        safety:          number;
        recommendation:  number;
        maintenance:     number;
        estimateLowSum:  number;
        estimateHighSum: number;
    };
    showEstimates:   boolean;
    branding?:       BrandingConfig | undefined;
    requestId?:      string | undefined;
    siblings?:       Array<{ id: string; templateName: string; status: string }> | undefined;
}

const CATEGORY_TONE: Record<RepairListEntry['category'], { bg: string; text: string; ring: string; label: string }> = {
    safety:         { bg: 'bg-rose-50',    text: 'text-rose-700',    ring: 'ring-rose-200',    label: 'Safety' },
    recommendation: { bg: 'bg-amber-50',   text: 'text-amber-700',   ring: 'ring-amber-200',   label: 'Recommend' },
    maintenance:    { bg: 'bg-slate-50',   text: 'text-slate-700',   ring: 'ring-slate-200',   label: 'Maintain' },
};

function formatMoney(cents: number | null): string {
    if (cents == null || cents <= 0) return '';
    // Estimates are stored as cents — render the dollar component.
    return `$${Math.round(cents / 100).toLocaleString()}`;
}

function groupBySection(entries: RepairListEntry[]): Array<{ sectionId: string; sectionTitle: string; items: RepairListEntry[] }> {
    const order: string[] = [];
    const map = new Map<string, { sectionId: string; sectionTitle: string; items: RepairListEntry[] }>();
    for (const e of entries) {
        if (!map.has(e.sectionId)) {
            map.set(e.sectionId, { sectionId: e.sectionId, sectionTitle: e.sectionTitle, items: [] });
            order.push(e.sectionId);
        }
        map.get(e.sectionId)!.items.push(e);
    }
    return order.map(id => map.get(id)!);
}

const REPAIR_LIST_CSS = `
@media print {
    .no-print { display: none !important; }
    body { background: white !important; }
    .repair-list-card { page-break-inside: avoid; break-inside: avoid; }
    .repair-list-section { page-break-inside: avoid; }
    .repair-list-section + .repair-list-section { page-break-before: auto; }
}
`;

export const RepairListPage = ({
    inspectionId,
    propertyAddress,
    inspectionDate,
    inspectorName,
    defects,
    totals,
    showEstimates,
    branding,
    requestId,
    siblings,
}: RepairListPageProps): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    const grouped = groupBySection(defects);

    return (
        <MainLayout
            title={`${siteName} | Repair List`}
            {...(branding ? { branding } : {})}
            extraHead={<style dangerouslySetInnerHTML={{ __html: REPAIR_LIST_CSS }} />}
        >
            <InspectionShell
                inspectionId={inspectionId}
                propertyAddress={propertyAddress}
                current="repair-list"
                enableRepairList={true}
                {...(requestId ? { requestId } : {})}
                {...(siblings  ? { siblings  } : {})}
            >
                <div class="space-y-6">
                    {/* Header summary + Print button */}
                    <div class="flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <h2 class="text-[18px] font-semibold tracking-tight text-slate-900">Repair list</h2>
                            <p class="text-[12px] text-slate-500">
                                Aggregated punch list of all flagged items. Printable for contractor handoff.
                            </p>
                        </div>
                        <div class="flex items-center gap-2">
                            <a
                                href={`/inspections/${inspectionId}/report`}
                                class="no-print inline-flex items-center gap-1.5 px-3 h-9 rounded-md bg-white border border-slate-200 text-slate-700 text-[12px] font-bold hover:bg-slate-50 transition-colors"
                            >
                                Edit in report tab
                            </a>
                            <button
                                type="button"
                                onclick="window.print()"
                                data-testid="repair-list-print"
                                class="no-print inline-flex items-center gap-1.5 px-3 h-9 rounded-md bg-slate-900 text-white text-[12px] font-bold hover:bg-slate-700 transition-colors"
                            >
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/>
                                </svg>
                                Print
                            </button>
                        </div>
                    </div>

                    {/* Property summary header (visible in print) */}
                    <div class="rounded-md border border-slate-200 bg-white px-5 py-4 repair-list-section">
                        <div class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1">Property</div>
                        <div class="text-[16px] font-semibold text-slate-900">{propertyAddress}</div>
                        <div class="text-[12px] text-slate-500 mt-1">
                            {inspectionDate ? <span>Inspected <strong class="text-slate-700">{inspectionDate}</strong></span> : null}
                            {inspectorName ? <span> &middot; By <strong class="text-slate-700">{inspectorName}</strong></span> : null}
                        </div>
                    </div>

                    {/* Totals strip */}
                    <div class="grid grid-cols-3 gap-3 repair-list-section">
                        <div class="rounded-md border border-rose-200 bg-rose-50 px-4 py-3">
                            <div class="text-[10px] font-bold uppercase tracking-[0.2em] text-rose-600">Safety</div>
                            <div class="text-[22px] font-bold text-rose-700 tabular-nums" data-testid="repair-list-total-safety">{totals.safety}</div>
                        </div>
                        <div class="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                            <div class="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-600">Recommend</div>
                            <div class="text-[22px] font-bold text-amber-700 tabular-nums" data-testid="repair-list-total-recommend">{totals.recommendation}</div>
                        </div>
                        <div class="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                            <div class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600">Maintenance</div>
                            <div class="text-[22px] font-bold text-slate-700 tabular-nums" data-testid="repair-list-total-maintenance">{totals.maintenance}</div>
                        </div>
                    </div>

                    {showEstimates && (totals.estimateLowSum > 0 || totals.estimateHighSum > 0) ? (
                        <div class="rounded-md border border-emerald-200 bg-emerald-50 px-5 py-4 flex items-center justify-between">
                            <div>
                                <div class="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-600">Estimated total repair range</div>
                                <div class="text-[12px] text-emerald-700 mt-1">Sum of all per-defect estimates supplied by the inspector.</div>
                            </div>
                            <div class="text-[20px] font-bold text-emerald-800 tabular-nums" data-testid="repair-list-estimate-total">
                                {formatMoney(totals.estimateLowSum)} – {formatMoney(totals.estimateHighSum)}
                            </div>
                        </div>
                    ) : null}

                    {/* Empty state */}
                    {defects.length === 0 ? (
                        <div class="text-center py-12 px-6 rounded-lg bg-emerald-50 border border-emerald-200" data-testid="repair-list-empty">
                            <p class="text-[13px] text-emerald-700 font-semibold">No defects flagged. The repair list is empty.</p>
                        </div>
                    ) : null}

                    {/* Defect cards grouped by section */}
                    {grouped.map(group => (
                        <section class="space-y-3 repair-list-section">
                            <header class="flex items-baseline justify-between border-b border-slate-200 pb-2">
                                <h3 class="text-[14px] font-bold text-slate-900">{group.sectionTitle}</h3>
                                <span class="text-[11px] text-slate-400 font-mono">{group.items.length} item{group.items.length === 1 ? '' : 's'}</span>
                            </header>
                            <ul class="space-y-3">
                                {group.items.map(d => {
                                    const tone = CATEGORY_TONE[d.category];
                                    const lo = formatMoney(d.estimateLow);
                                    const hi = formatMoney(d.estimateHigh);
                                    const showEstimateBadge = showEstimates && (lo || hi);
                                    return (
                                        <li
                                            class="repair-list-card rounded-md border border-slate-200 bg-white px-5 py-4"
                                            data-testid="repair-list-card"
                                            data-category={d.category}
                                        >
                                            <div class="flex items-start justify-between gap-3 mb-2">
                                                <div class="flex-1 min-w-0">
                                                    <div class="flex flex-wrap items-center gap-2 mb-1">
                                                        <span class={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${tone.bg} ${tone.text} ${tone.ring}`}>
                                                            {tone.label}
                                                        </span>
                                                        <span class="text-[11px] font-mono text-slate-400">{group.sectionTitle} &rsaquo; {d.itemLabel}</span>
                                                    </div>
                                                    <p class="text-[14px] font-semibold text-slate-900 leading-snug">{d.itemLabel}</p>
                                                    {d.location ? (
                                                        <p class="text-[12px] text-slate-500 mt-0.5">Location: {d.location}</p>
                                                    ) : null}
                                                </div>
                                                {d.recommendationLabel ? (
                                                    <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200">
                                                        {d.recommendationLabel}
                                                    </span>
                                                ) : null}
                                            </div>

                                            {d.comment ? (
                                                <p class="text-[13px] text-slate-700 leading-relaxed whitespace-pre-line">{d.comment}</p>
                                            ) : null}

                                            {showEstimateBadge ? (
                                                <div class="mt-3 inline-flex items-center px-2 py-1 rounded-md text-[12px] font-semibold bg-emerald-50 text-emerald-700 tabular-nums" data-testid="repair-list-card-estimate">
                                                    Estimated cost: {lo || '$?'} – {hi || '$?'}
                                                </div>
                                            ) : null}

                                            {d.photos.length > 0 ? (
                                                <div class="mt-3 grid grid-cols-3 gap-2">
                                                    {d.photos.slice(0, 6).map((p, idx) => (
                                                        <img
                                                            src={p.url}
                                                            alt={`${d.itemLabel} photo ${idx + 1}`}
                                                            class="w-full h-24 object-cover rounded border border-slate-200"
                                                            loading="lazy"
                                                        />
                                                    ))}
                                                </div>
                                            ) : null}
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    ))}
                </div>
            </InspectionShell>
        </MainLayout>
    );
};
