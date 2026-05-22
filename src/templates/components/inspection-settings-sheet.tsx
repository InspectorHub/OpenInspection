/**
 * Design-alignment B+C — Inspection settings slide-over.
 *
 * Replaces the retired `/inspections/:id/settings` standalone tab. Same
 * form contents (Schedule / Order & referral / Template / Pricing &
 * gates / People / Property Facts) folded into a slide-over sheet so
 * the editor keeps its single-view chrome.
 *
 * Triggered from the editor toolbar's gear button via a window event
 * (`inspection-settings:open`). The Alpine factory
 * `inspectionSettingsPage` carries unchanged from the old page — it
 * reads `inspectionId` off the parent editor scope and POSTs to the
 * existing PATCH /api/inspections/:id endpoint.
 */

import { PeopleCard } from './people-card';
import { PropertyFactsCard } from './property-facts-card';
import { SEED_REFERRAL_SOURCES, resolveReferralSources } from '../../lib/referral-sources';

export interface InspectionSettingsSheetProps {
    inspectionId:           string;
    customReferralSources?: string[];
}

export const InspectionSettingsSheet = ({
    inspectionId,
    customReferralSources,
}: InspectionSettingsSheetProps): JSX.Element => {
    const referralSources = resolveReferralSources(customReferralSources);
    const sources = referralSources.length > 0 ? referralSources : [...SEED_REFERRAL_SOURCES];

    return (
        <div
            x-data={`{ open: false, sheetInspectionId: '${inspectionId}' }`}
            {...{
                'x-on:inspection-settings:open.window': 'open = true; $nextTick(() => $dispatch("inspection-settings:loaded"))',
                'x-on:keydown.escape.window': 'open = false',
            }}
        >
            <div
                x-show="open"
                x-cloak
                x-on:click="open = false"
                class="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm"
                aria-hidden="true"
                {...{ 'x-transition.opacity': '' }}
            ></div>
            <aside
                x-show="open"
                x-cloak
                x-transition:enter="transition ease-out duration-200"
                x-transition:enter-start="translate-x-full"
                x-transition:enter-end="translate-x-0"
                x-transition:leave="transition ease-in duration-150"
                x-transition:leave-start="translate-x-0"
                x-transition:leave-end="translate-x-full"
                role="dialog"
                aria-modal="true"
                aria-label="Inspection settings"
                class="fixed top-0 right-0 bottom-0 w-full max-w-xl z-[61] bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col"
            >
                <header class="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-200 dark:border-slate-700">
                    <div class="min-w-0">
                        <h2 class="text-[14px] font-bold text-slate-900 dark:text-slate-100">Inspection settings</h2>
                        <p class="text-[11px] text-slate-500 dark:text-slate-400">Schedule, people, template, pricing & gates</p>
                    </div>
                    <button
                        type="button"
                        x-on:click="open = false"
                        aria-label="Close"
                        class="p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                </header>

                <div
                    x-data={`inspectionSettingsPage(sheetInspectionId)`}
                    x-init="load()"
                    class="flex-1 overflow-y-auto px-5 py-4"
                >
                    <div class="space-y-8 max-w-2xl">
                        <div x-show="loading" aria-busy="true" class="space-y-2 py-4">
                            <span class="sr-only">Loading…</span>
                            <div class="ih-skeleton ih-skeleton--text" style="width: 50%;"></div>
                            <div class="ih-skeleton ih-skeleton--text" style="width: 75%;"></div>
                        </div>

                        {/* Round-2 F3 — People card with role chips. */}
                        <PeopleCard />

                        <form x-show="!loading" style="display:none" {...{ 'x-on:submit.prevent': 'save()' }} class="space-y-6">
                            <fieldset class="space-y-4">
                                <legend class="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">Schedule</legend>
                                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <label class="block">
                                        <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Date</span>
                                        {/* type=text + data-flatpickr — Chromium ignores `lang="en"`
                                            on type=date inputs, leaking the OS locale (e.g. "年/月/日"
                                            on zh-CN). Flatpickr renders a locale-independent picker
                                            with the canonical "Y-m-d" format. */}
                                        <input
                                            type="text"
                                            data-flatpickr
                                            data-no-time
                                            placeholder="YYYY-MM-DD"
                                            x-model="form.date"
                                            class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-[14px] font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                        />
                                    </label>
                                    <label class="block">
                                        <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Inspector</span>
                                        <select
                                            x-model="form.inspectorId"
                                            class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-[14px] font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                        >
                                            <option value="">— Unassigned —</option>
                                            <template x-for="u in inspectors" {...{ 'x-bind:key': 'u.id' }}>
                                                <option {...{ 'x-bind:value': 'u.id' }} x-text="u.name || u.email"></option>
                                            </template>
                                        </select>
                                    </label>
                                </div>
                                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <label class="block">
                                        <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Closing Date</span>
                                        <input
                                            type="text"
                                            data-flatpickr
                                            data-no-time
                                            placeholder="YYYY-MM-DD"
                                            data-testid="inspection-closing-date"
                                            x-model="form.closingDate"
                                            class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-[14px] font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                        />
                                    </label>
                                </div>
                            </fieldset>

                            {/* Property Facts — same component the standalone tab used.
                                The editor canvas also has its own __property__ section,
                                but keeping this card in the sheet means the inspector
                                can edit facts without switching the rail away from the
                                section they're rating. */}
                            <PropertyFactsCard />

                            <fieldset class="space-y-4">
                                <legend class="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">Order &amp; referral</legend>
                                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <label class="block">
                                        <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Order ID</span>
                                        <input
                                            type="text"
                                            maxLength={64}
                                            placeholder="—"
                                            data-testid="inspection-order-id"
                                            x-model="form.orderId"
                                            class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-[14px] font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none placeholder:text-slate-300 dark:placeholder:text-slate-600"
                                        />
                                    </label>
                                    <label class="block">
                                        <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Referral Source</span>
                                        <select
                                            data-testid="inspection-referral-source"
                                            x-model="form.referralSource"
                                            class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-[14px] font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                        >
                                            <option value="">— Select source —</option>
                                            {sources.map(s => (
                                                <option value={s}>{s}</option>
                                            ))}
                                        </select>
                                    </label>
                                </div>
                            </fieldset>

                            <fieldset class="space-y-4">
                                <legend class="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">Template</legend>
                                <label class="block">
                                    <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Inspection template</span>
                                    <select
                                        x-model="form.templateId"
                                        class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-[14px] font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                    >
                                        <option value="">— Select template —</option>
                                        <template x-for="t in templates" {...{ 'x-bind:key': 't.id' }}>
                                            <option {...{ 'x-bind:value': 't.id' }} x-text="t.name"></option>
                                        </template>
                                    </select>
                                </label>
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
                                <legend class="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">Pricing &amp; gates</legend>
                                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <label class="block">
                                        <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Price (cents)</span>
                                        <input
                                            type="number"
                                            min="0"
                                            step="100"
                                            {...{ 'x-model.number': 'form.price' }}
                                            class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-[14px] font-medium tabular-nums focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                        />
                                    </label>
                                    <div class="flex flex-col gap-2 pt-5">
                                        <label class="inline-flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-300">
                                            <input type="checkbox" x-model="form.paymentRequired" class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/20" />
                                            Payment required to view report
                                        </label>
                                        <label class="inline-flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-300">
                                            <input type="checkbox" x-model="form.agreementRequired" class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/20" />
                                            Agreement signature required
                                        </label>
                                    </div>
                                </div>
                            </fieldset>

                            <div class="flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-700 pt-4">
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
                </div>
            </aside>
        </div>
    );
};
