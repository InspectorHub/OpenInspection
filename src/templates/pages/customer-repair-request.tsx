/**
 * Sprint 3 Track B (S3-2) — Customer-driven Repair Request export.
 *
 * Public, token-gated companion to the inspector-facing repair list (Track
 * E1). The customer who received the report opens this page from a link on
 * the published report (`/report/:id`), reviews the per-defect cards, can
 * jot per-item comments to share with their contractor, and either:
 *
 *   1. Print / save to PDF via `window.print()` (uses the same
 *      `@media print` rules as the inspector repair list); or
 *   2. Email the list to themselves via the
 *      `POST /api/public/repair-request/email` endpoint.
 *
 * Distinct from the inspector view: this page is the homeowner / buyer's
 * tool, no inspector chrome (no shell sub-nav, no "Edit in report tab"
 * link). Every interaction is fully public — no JWT — but the same
 * payment + agreement gates that protect the report itself protect this
 * export (the route mirrors `/report/:id` gating server-side).
 */

import { BareLayout } from '../layouts/main-layout';
import type { BrandingConfig } from '../../types/auth';

export interface CustomerRepairRequestEntry {
    sectionId:           string;
    sectionTitle:        string;
    itemId:              string;
    itemLabel:           string;
    comment:             string;
    location:            string | null;
    category:            'safety' | 'recommendation' | 'maintenance';
    recommendationLabel: string | null;
    estimateLow:         number | null;
    estimateHigh:        number | null;
    photos:              Array<{ key: string; url: string }>;
}

export interface CustomerRepairRequestPageProps {
    inspectionId:    string;
    propertyAddress: string;
    inspectionDate:  string | null;
    inspectorName:   string | null;
    clientEmail:     string | null;
    defects:         CustomerRepairRequestEntry[];
    showEstimates:   boolean;
    branding?:       BrandingConfig | undefined;
}

const CATEGORY_TONE: Record<CustomerRepairRequestEntry['category'], { bg: string; text: string; ring: string; label: string }> = {
    safety:         { bg: 'bg-rose-50',  text: 'text-rose-700',  ring: 'ring-rose-200',  label: 'Safety' },
    recommendation: { bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200', label: 'Recommend' },
    maintenance:    { bg: 'bg-slate-50', text: 'text-slate-700', ring: 'ring-slate-200', label: 'Maintain' },
};

function formatMoney(cents: number | null): string {
    if (cents == null || cents <= 0) return '';
    return `$${Math.round(cents / 100).toLocaleString()}`;
}

function groupBySection(entries: CustomerRepairRequestEntry[]): Array<{ sectionId: string; sectionTitle: string; items: CustomerRepairRequestEntry[] }> {
    const order: string[] = [];
    const map = new Map<string, { sectionId: string; sectionTitle: string; items: CustomerRepairRequestEntry[] }>();
    for (const e of entries) {
        if (!map.has(e.sectionId)) {
            map.set(e.sectionId, { sectionId: e.sectionId, sectionTitle: e.sectionTitle, items: [] });
            order.push(e.sectionId);
        }
        map.get(e.sectionId)!.items.push(e);
    }
    return order.map(id => map.get(id)!);
}

const CUSTOMER_REPAIR_CSS = `
@media print {
    .no-print { display: none !important; }
    body { background: white !important; }
    .crr-card { page-break-inside: avoid; break-inside: avoid; }
    .crr-section { page-break-inside: avoid; }
    textarea.crr-comments {
        border: 1px dashed #cbd5e1;
        background: white !important;
    }
}
textarea.crr-comments {
    background: #f8fafc;
}
`;

export const CustomerRepairRequestPage = ({
    inspectionId,
    propertyAddress,
    inspectionDate,
    inspectorName,
    clientEmail,
    defects,
    showEstimates,
    branding,
}: CustomerRepairRequestPageProps): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    const grouped = groupBySection(defects);
    // Encode props for the Alpine x-data initializer. The runtime collects
    // the per-item textarea inputs into a single payload before posting to
    // the email endpoint.
    const itemRefs = defects.map(d => ({ itemId: d.itemId, sectionTitle: d.sectionTitle, itemLabel: d.itemLabel }));
    const initialState = JSON.stringify({
        inspectionId,
        recipientEmail: clientEmail || '',
        items: itemRefs,
    }).replace(/'/g, '&#39;');

    return (
        <BareLayout
            title={`${siteName} | Repair request`}
            {...(branding ? { branding } : {})}
            extraHead={<style dangerouslySetInnerHTML={{ __html: CUSTOMER_REPAIR_CSS }} />}
        >
            <div
                class="max-w-3xl mx-auto px-4 sm:px-6 py-8"
                x-data={`customerRepairRequest(${initialState})`}
                data-testid="customer-repair-request-root"
            >
                {/* Header */}
                <header class="mb-6">
                    <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                        Repair Request
                    </p>
                    <h1 class="text-[24px] sm:text-[28px] font-semibold tracking-tight text-slate-900 leading-tight">
                        {propertyAddress}
                    </h1>
                    <p class="text-[13px] text-slate-500 mt-2">
                        Generated from your inspection report. Review the items below, add any
                        comments for your contractor, then print this list or email a copy to yourself.
                    </p>
                    {inspectionDate || inspectorName ? (
                        <p class="text-[12px] text-slate-500 mt-1">
                            {inspectionDate ? <span>Inspected <strong class="text-slate-700">{inspectionDate}</strong></span> : null}
                            {inspectorName ? <span> &middot; By <strong class="text-slate-700">{inspectorName}</strong></span> : null}
                        </p>
                    ) : null}
                </header>

                {/* Toolbar (hidden in print) */}
                <div class="no-print mb-6 flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onclick="window.print()"
                        data-testid="crr-print"
                        class="inline-flex items-center gap-1.5 px-3 h-9 rounded-md bg-slate-900 text-white text-[12px] font-bold hover:bg-slate-700 transition-colors"
                    >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                        Download PDF
                    </button>
                    <div class="flex items-center gap-2 flex-1 min-w-[260px]">
                        <input
                            type="email"
                            x-model="recipientEmail"
                            placeholder="you@example.com"
                            data-testid="crr-email-input"
                            class="flex-1 h-9 px-3 rounded-md border border-slate-200 text-[13px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
                        />
                        <button
                            type="button"
                            x-on:click="sendEmail()"
                            x-bind:disabled="sending || !recipientEmail"
                            data-testid="crr-email-submit"
                            class="inline-flex items-center gap-1.5 px-3 h-9 rounded-md bg-blue-600 text-white text-[12px] font-bold hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                        >
                            <span x-show="!sending">Email this list to me</span>
                            <span x-show="sending" style="display:none">Sending&hellip;</span>
                        </button>
                    </div>
                </div>

                {/* Toast */}
                <div
                    x-show="toast"
                    x-transition
                    style="display:none"
                    class="no-print mb-4 px-4 py-2 rounded-md text-[13px] font-semibold"
                    x-bind:class="toastError ? 'bg-rose-50 text-rose-800 border border-rose-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'"
                    data-testid="crr-toast"
                    x-text="toast"
                ></div>

                {/* Empty state */}
                {defects.length === 0 ? (
                    <div
                        class="text-center py-12 px-6 rounded-md bg-emerald-50 border border-emerald-200"
                        data-testid="crr-empty"
                    >
                        <p class="text-[14px] text-emerald-700 font-semibold">
                            Good news! No defects were flagged on your inspection.
                        </p>
                        <p class="text-[12px] text-emerald-600 mt-1">
                            There is nothing to request a repair for.
                        </p>
                    </div>
                ) : null}

                {/* Defects grouped by section */}
                {grouped.map(group => (
                    <section class="space-y-3 mb-8 crr-section">
                        <header class="flex items-baseline justify-between border-b border-slate-200 pb-2">
                            <h2 class="text-[14px] font-bold text-slate-900">{group.sectionTitle}</h2>
                            <span class="text-[11px] text-slate-400 font-mono">
                                {group.items.length} item{group.items.length === 1 ? '' : 's'}
                            </span>
                        </header>
                        <ul class="space-y-3">
                            {group.items.map((d, idx) => {
                                const tone = CATEGORY_TONE[d.category];
                                const lo = formatMoney(d.estimateLow);
                                const hi = formatMoney(d.estimateHigh);
                                const showEstimateBadge = showEstimates && (lo || hi);
                                return (
                                    <li
                                        class="crr-card rounded-md border border-slate-200 bg-white px-5 py-4"
                                        data-testid="crr-card"
                                        data-category={d.category}
                                    >
                                        <div class="flex items-start justify-between gap-3 mb-2">
                                            <div class="flex-1 min-w-0">
                                                <div class="flex flex-wrap items-center gap-2 mb-1">
                                                    <span class={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${tone.bg} ${tone.text} ${tone.ring}`}>
                                                        {tone.label}
                                                    </span>
                                                    <span class="text-[11px] font-mono text-slate-400">
                                                        {group.sectionTitle} &rsaquo; {d.itemLabel}
                                                    </span>
                                                </div>
                                                <p class="text-[14px] font-semibold text-slate-900 leading-snug">
                                                    {d.itemLabel}
                                                </p>
                                                {d.location ? (
                                                    <p class="text-[12px] text-slate-500 mt-0.5">
                                                        Location: {d.location}
                                                    </p>
                                                ) : null}
                                            </div>
                                            {d.recommendationLabel ? (
                                                <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200">
                                                    {d.recommendationLabel}
                                                </span>
                                            ) : null}
                                        </div>

                                        {d.comment ? (
                                            <p class="text-[13px] text-slate-700 leading-relaxed whitespace-pre-line">
                                                {d.comment}
                                            </p>
                                        ) : null}

                                        {showEstimateBadge ? (
                                            <div
                                                class="mt-3 inline-flex items-center px-2 py-1 rounded-md text-[12px] font-semibold bg-emerald-50 text-emerald-700 tabular-nums"
                                                data-testid="crr-card-estimate"
                                            >
                                                Estimated cost: {lo || '$?'} – {hi || '$?'}
                                            </div>
                                        ) : null}

                                        {d.photos.length > 0 ? (
                                            <div class="mt-3 grid grid-cols-3 gap-2">
                                                {d.photos.slice(0, 6).map((p, pi) => (
                                                    <img
                                                        src={p.url}
                                                        alt={`${d.itemLabel} photo ${pi + 1}`}
                                                        class="w-full h-24 object-cover rounded border border-slate-200"
                                                        loading="lazy"
                                                    />
                                                ))}
                                            </div>
                                        ) : null}

                                        {/* Customer comments — printed line for the contractor. */}
                                        <div class="mt-3">
                                            <label
                                                class="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1"
                                                for={`crr-note-${d.itemId}-${idx}`}
                                            >
                                                Your notes for the contractor
                                            </label>
                                            <textarea
                                                id={`crr-note-${d.itemId}-${idx}`}
                                                rows={2}
                                                class="crr-comments w-full px-3 py-2 rounded-md border border-slate-200 text-[13px] text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
                                                placeholder="Optional comment (e.g. preferred quote scope, timing, access details)"
                                                data-testid="crr-card-note"
                                                x-on:input={`itemNotes['${d.itemId}'] = $event.target.value`}
                                            ></textarea>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                ))}

                <footer class="no-print mt-12 pt-6 border-t border-slate-200 text-[11px] text-slate-400 text-center">
                    Generated by <strong class="text-slate-600">{siteName}</strong>. This list reflects
                    items flagged in your inspection report and does not constitute a legally binding
                    contract or repair scope.
                </footer>
            </div>

            <script src="/js/auth.js"></script>
            <script src="/js/customer-repair-request.js"></script>
        </BareLayout>
    );
};
