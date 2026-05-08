/**
 * Sprint 2 S2-5 — `/inspections/:id/signatures` sub-page.
 *
 * Lists every agreement request tied to this inspection plus the e-sign
 * audit chain timeline. Reuses the existing /api/inspections/:id endpoint
 * for the agreement metadata and /api/public/verify/:envelopeId/audit-trail
 * for the chain export.
 */

import { MainLayout } from '../../layouts/main-layout';
import { InspectionShell } from '../../components/inspection-shell';
import type { BrandingConfig } from '../../../types/auth';

export interface InspectionSignaturesPageProps {
    inspectionId:     string;
    propertyAddress:  string;
    branding?:        BrandingConfig | undefined;
    requestId?:       string | undefined;
    siblings?:        Array<{ id: string; templateName: string; status: string }> | undefined;
    enableRepairList?: boolean;
}

export const InspectionSignaturesPage = ({
    inspectionId,
    propertyAddress,
    branding,
    requestId,
    siblings,
    enableRepairList,
}: InspectionSignaturesPageProps): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout
            title={`${siteName} | Signatures`}
            {...(branding ? { branding } : {})}
        >
            <InspectionShell
                inspectionId={inspectionId}
                propertyAddress={propertyAddress}
                current="signatures"
                enableRepairList={!!enableRepairList}
                {...(requestId ? { requestId } : {})}
                {...(siblings  ? { siblings  } : {})}
            >
                <div x-data={`inspectionSignaturesPage('${inspectionId}')`} x-init="load()" class="space-y-6">
                    <div class="space-y-1">
                        <h2 class="text-[18px] font-semibold tracking-tight text-slate-900">Agreements & signatures</h2>
                        <p class="text-[12px] text-slate-500">Tracks every agreement envelope created for this inspection plus its tamper-evident audit chain.</p>
                    </div>

                    <div x-show="loading" class="text-center py-12 text-slate-400 text-[13px]">Loading…</div>

                    <div x-show="!loading && envelopes.length === 0" style="display:none" class="text-center py-12 px-6 rounded-lg bg-slate-50 border border-slate-200">
                        <p class="text-[13px] text-slate-500">No agreement envelopes attached to this inspection yet.</p>
                        <a href="/agreements" class="inline-block mt-3 text-[12px] font-bold text-indigo-600 hover:underline">Create an agreement</a>
                    </div>

                    <template x-for="env in envelopes" {...{ 'x-bind:key': 'env.id' }}>
                        <article class="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
                            <header class="flex flex-wrap items-start justify-between gap-3">
                                <div class="min-w-0">
                                    <h3 class="text-[14px] font-bold text-slate-900 truncate" x-text="env.agreementName"></h3>
                                    <p class="text-[12px] text-slate-500" x-text="env.clientEmail"></p>
                                </div>
                                <span
                                    class="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-[0.2em] ring-1 ring-inset"
                                    {...{ 'x-bind:class': "{'bg-emerald-50 text-emerald-700 ring-emerald-200': env.status==='signed','bg-amber-50 text-amber-700 ring-amber-200': env.status==='viewed' || env.status==='sent','bg-slate-100 text-slate-600 ring-slate-200': env.status==='pending','bg-rose-50 text-rose-700 ring-rose-200': env.status==='declined' || env.status==='expired'}" }}
                                    x-text="env.status"
                                ></span>
                            </header>

                            <div class="flex flex-wrap gap-2 text-[12px]">
                                <a
                                    x-bind:href={"'/agreements/sign/' + env.token"}
                                    target="_blank"
                                    rel="noopener"
                                    class="inline-flex items-center gap-1 px-2.5 h-7 rounded-md bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition-colors"
                                >View envelope</a>
                                <a
                                    x-show="env.status === 'signed'"
                                    x-bind:href={"'/verify/' + env.id"}
                                    target="_blank"
                                    rel="noopener"
                                    class="inline-flex items-center gap-1 px-2.5 h-7 rounded-md bg-indigo-50 text-indigo-700 font-semibold hover:bg-indigo-100 transition-colors"
                                >Open public verifier</a>
                            </div>

                            <div x-show="env.events && env.events.length > 0" style="display:none" class="border-t border-slate-100 pt-3">
                                <h4 class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">Audit chain</h4>
                                <ol class="space-y-1.5">
                                    <template x-for="ev in env.events" {...{ 'x-bind:key': 'ev.hash' }}>
                                        <li class="flex items-center gap-2 text-[12px]">
                                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0"></span>
                                            <span class="font-mono text-slate-500" x-text="new Date(ev.createdAtUtc).toLocaleString()"></span>
                                            <span class="font-semibold text-slate-700" x-text="ev.event"></span>
                                        </li>
                                    </template>
                                </ol>
                            </div>
                        </article>
                    </template>
                </div>
            </InspectionShell>
            <script src="/js/auth.js"></script>
            <script src="/js/inspection-signatures.js"></script>
        </MainLayout>
    );
};
