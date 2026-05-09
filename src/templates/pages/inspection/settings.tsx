/**
 * Sprint 2 S2-5 — `/inspections/:id/settings` sub-page.
 *
 * Inspection-level config: template, scheduled date/time, assigned inspector.
 * The form posts a PUT to /api/inspections/:id (existing endpoint) — no new
 * server work needed.
 *
 * Per coordination note in the dispatch plan: when T1's
 * `template.rating_system_id` field lands, this page will display it as a
 * read-only badge. We pre-build the badge slot with a null-safe fallback so
 * merge order doesn't matter.
 */

import { MainLayout } from '../../layouts/main-layout';
import { InspectionShell } from '../../components/inspection-shell';
import { PeopleCard } from '../../components/people-card';
import { PropertyFactsCard } from '../../components/property-facts-card';
import { SEED_REFERRAL_SOURCES, resolveReferralSources } from '../../../lib/referral-sources';
import type { BrandingConfig } from '../../../types/auth';

export interface InspectionSettingsPageProps {
    inspectionId:     string;
    propertyAddress:  string;
    branding?:        BrandingConfig | undefined;
    requestId?:       string | undefined;
    siblings?:        Array<{ id: string; templateName: string; status: string }> | undefined;
    enableRepairList?: boolean;
    // Round-2 backlog G3 — tenant-defined referral sources are appended to
    // the seven seeds. Server resolves the merged list before render.
    customReferralSources?: string[] | undefined;
}

export const InspectionSettingsPage = ({
    inspectionId,
    propertyAddress,
    branding,
    requestId,
    siblings,
    enableRepairList,
    customReferralSources,
}: InspectionSettingsPageProps): JSX.Element => {
    const referralSources = resolveReferralSources(customReferralSources);
    // Backstop in case the resolver shape changes — the seven seeds always
    // need to be available.
    const sources = referralSources.length > 0 ? referralSources : [...SEED_REFERRAL_SOURCES];
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout
            title={`${siteName} | Settings`}
            {...(branding ? { branding } : {})}
        >
            <InspectionShell
                inspectionId={inspectionId}
                propertyAddress={propertyAddress}
                current="settings"
                enableRepairList={!!enableRepairList}
                {...(requestId ? { requestId } : {})}
                {...(siblings  ? { siblings  } : {})}
            >
                <div x-data={`inspectionSettingsPage('${inspectionId}')`} x-init="load()" class="space-y-8 max-w-2xl">
                    <div x-show="loading" class="text-center py-12 text-slate-400 text-[13px]">Loading…</div>

                    {/* Round-2 F3 — People card with role chips. Auto-loads
                        from /api/inspections/:id/people via the settings
                        Alpine factory; auto-hides when nothing returned. */}
                    <PeopleCard />

                    <form x-show="!loading" style="display:none" {...{ 'x-on:submit.prevent': 'save()' }} class="space-y-6">
                        <fieldset class="space-y-4">
                            <legend class="text-[16px] font-semibold tracking-tight text-slate-900">Schedule</legend>
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <label class="block">
                                    <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Date</span>
                                    {/* Iter-2 bug #6 — explicit `lang="en"` stops Chrome on
                                        zh-CN OS locales from rendering the native date
                                        placeholder as 「年/月/日」. */}
                                    <input
                                        type="date"
                                        lang="en"
                                        placeholder="YYYY-MM-DD"
                                        x-model="form.date"
                                        class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 text-[14px] font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                    />
                                </label>
                                <label class="block">
                                    <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Inspector</span>
                                    <select
                                        x-model="form.inspectorId"
                                        class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 text-[14px] font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                    >
                                        <option value="">— Unassigned —</option>
                                        <template x-for="u in inspectors" {...{ 'x-bind:key': 'u.id' }}>
                                            <option {...{ 'x-bind:value': 'u.id' }} x-text="u.name || u.email"></option>
                                        </template>
                                    </select>
                                </label>
                            </div>
                            {/* Round-2 backlog G2 (Spectora §7.10) — Closing
                                Date single picker. Used for follow-up CRM
                                signals; never gates the report. */}
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <label class="block">
                                    <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Closing Date</span>
                                    {/* Iter-2 bug #6 — same as the schedule date input above:
                                        explicit `lang="en"` overrides the OS locale so users
                                        on zh-CN do not see 「年/月/日」 as the placeholder. */}
                                    <input
                                        type="date"
                                        lang="en"
                                        placeholder="YYYY-MM-DD"
                                        data-testid="inspection-closing-date"
                                        x-model="form.closingDate"
                                        class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 text-[14px] font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                    />
                                </label>
                            </div>
                        </fieldset>

                        {/* Round-2 backlog G1 (Spectora §E.2) — Property
                            Facts strip. Six inline-editable fields. Saves
                            via /api/inspections/:id/property-facts on
                            change rather than waiting for the form submit. */}
                        <PropertyFactsCard />

                        {/* Round-2 backlog G3 (Spectora §4.1, ITB UC-ITB-10)
                            — Order ID + Referral Source. Both optional.
                            Order ID is free-text up to 64 chars (ISN-style
                            identifier). Referral Source is the merged
                            seed + tenant custom list. */}
                        <fieldset class="space-y-4">
                            <legend class="text-[16px] font-semibold tracking-tight text-slate-900">Order &amp; referral</legend>
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <label class="block">
                                    <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Order ID</span>
                                    <input
                                        type="text"
                                        maxLength={64}
                                        placeholder="—"
                                        data-testid="inspection-order-id"
                                        x-model="form.orderId"
                                        class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 text-[14px] font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none placeholder:text-slate-300"
                                    />
                                </label>
                                <label class="block">
                                    <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Referral Source</span>
                                    <select
                                        data-testid="inspection-referral-source"
                                        x-model="form.referralSource"
                                        class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 text-[14px] font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                    >
                                        <option value="">— Select source —</option>
                                        {sources.map(s => (
                                            <option value={s}>{s}</option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            <p class="text-[12px] text-slate-500">
                                Add custom referral sources at <a href="/settings/workspace/referral" class="text-indigo-600 hover:underline">Settings → Workspace → Referral Sources</a>.
                            </p>
                        </fieldset>

                        <fieldset class="space-y-4">
                            <legend class="text-[16px] font-semibold tracking-tight text-slate-900">Template</legend>
                            <label class="block">
                                <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Inspection template</span>
                                <select
                                    x-model="form.templateId"
                                    class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 text-[14px] font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                >
                                    <option value="">— Select template —</option>
                                    <template x-for="t in templates" {...{ 'x-bind:key': 't.id' }}>
                                        <option {...{ 'x-bind:value': 't.id' }} x-text="t.name"></option>
                                    </template>
                                </select>
                            </label>
                            {/*
                              Rating system badge — driven by T1's
                              template.rating_system_id when present. The
                              `ratingSystemLabel` getter handles `null` so
                              merge order with T1 doesn't matter.
                            */}
                            <div
                                x-show="ratingSystemLabel"
                                style="display:none"
                                class="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-indigo-50 ring-1 ring-inset ring-indigo-200 text-[11px] font-bold text-indigo-700"
                            >
                                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>
                                Rating system: <span x-text="ratingSystemLabel"></span>
                            </div>
                        </fieldset>

                        <fieldset class="space-y-4">
                            <legend class="text-[16px] font-semibold tracking-tight text-slate-900">Pricing & gates</legend>
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <label class="block">
                                    <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Price (cents)</span>
                                    <input
                                        type="number"
                                        min="0"
                                        step="100"
                                        {...{ 'x-model.number': 'form.price' }}
                                        class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 text-[14px] font-medium tabular-nums focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                    />
                                </label>
                                <div class="flex flex-col gap-2 pt-5">
                                    <label class="inline-flex items-center gap-2 text-[13px] text-slate-700">
                                        <input type="checkbox" x-model="form.paymentRequired" class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/20" />
                                        Payment required to view report
                                    </label>
                                    <label class="inline-flex items-center gap-2 text-[13px] text-slate-700">
                                        <input type="checkbox" x-model="form.agreementRequired" class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/20" />
                                        Agreement signature required
                                    </label>
                                </div>
                            </div>
                        </fieldset>

                        <div class="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
                            <span x-show="saveState === 'saving'" class="text-[12px] text-amber-600 font-bold">Saving…</span>
                            <span x-show="saveState === 'saved'"  style="display:none" class="text-[12px] text-emerald-600 font-bold">Saved</span>
                            <span x-show="saveState === 'error'"  style="display:none" class="text-[12px] text-rose-600 font-bold">Error — try again</span>
                            <button
                                type="submit"
                                class="h-10 px-4 rounded-md bg-indigo-600 text-white text-[13px] font-bold hover:bg-indigo-700 transition-colors disabled:bg-slate-300"
                                {...{ 'x-bind:disabled': "saveState === 'saving'" }}
                            >Save changes</button>
                        </div>
                    </form>
                </div>
            </InspectionShell>
            <script src="/js/auth.js"></script>
            <script src="/js/inspection-settings.js"></script>
        </MainLayout>
    );
};
