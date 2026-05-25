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
                                {/* Feature #20 phase 2 — inline rating system swap.
                                    Reads /api/rating-systems on sheet open, shows the
                                    current snapshot's system as the selected option,
                                    and opens an inline confirmation modal (oiPrompt
                                    pattern, no window.confirm) with three explicit
                                    options before POSTing to /switch-rating-system. */}
                                <label class="block">
                                    <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Rating system</span>
                                    <select
                                        x-model="form.ratingSystemId"
                                        x-on:change="openRatingSwitchPrompt($event.target.value)"
                                        class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-[14px] font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                                    >
                                        <template x-for="rs in ratingSystems" {...{ 'x-bind:key': 'rs.id' }}>
                                            <option {...{ 'x-bind:value': 'rs.id' }} x-text="rs.name + ' (' + (rs.levels?.length || 0) + ' levels)'"></option>
                                        </template>
                                    </select>
                                    <p class="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                                        Switching maps each rated item to the new system by severity bucket. Items without a matching bucket lose their rating. Notes, photos, and comments are preserved.
                                    </p>
                                </label>

                                {/* Feature #20 phase 3 — Save back / Save as new template.
                                    Both act on the current snapshot's structure (sections +
                                    items + rating system) without copying any per-item
                                    ratings/notes/photos. Save back overwrites the source
                                    template (other future inspections inherit). Save as
                                    new creates a fresh template row in the tenant library. */}
                                <div class="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        x-on:click="openSaveBackPrompt()"
                                        class="h-9 px-3 rounded-md text-[12px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 ring-1 ring-inset ring-amber-200 dark:ring-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                                        title="Overwrite the source template with this inspection's structure"
                                    >Save back to template</button>
                                    <button
                                        type="button"
                                        x-on:click="openSaveAsNewPrompt()"
                                        class="h-9 px-3 rounded-md text-[12px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 ring-1 ring-inset ring-indigo-200 dark:ring-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
                                        title="Freeze this inspection's structure as a new tenant template"
                                    >Save as new template…</button>
                                </div>
                                <p class="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                                    Both options copy the section + item structure and the rating system only. Per-item ratings, notes, and photos stay with this inspection.
                                </p>
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

/**
 * Feature #20 phase 2 — rating system switch confirmation modal.
 *
 * Lives at the page root (not inside the settings sheet's <aside>) so its
 * `fixed inset-0` overlay isn't clipped by the sheet's transform / max-w
 * constraints. State (ratingSwitchPrompt) lives in the inspectionSettingsPage
 * Alpine factory; we read it here via $store + dispatched window events so
 * the modal doesn't need to inherit the sheet's scope.
 *
 * Three explicit actions instead of OK/Cancel: Remap by severity, Clear all
 * ratings, Cancel. Never use window.confirm.
 */
export const RatingSwitchConfirmModal = (): JSX.Element => (
    <div
        x-data="{
            prompt: { show: false, targetName: '', targetLevelCount: 0, ratedCount: 0, busy: false },
            close() { this.prompt = { ...this.prompt, show: false, busy: false }; },
            cancel() { window.dispatchEvent(new CustomEvent('rating-switch-cancel')); this.close(); },
            confirm(mode) {
                if (this.prompt.busy) return;
                this.prompt.busy = true;
                window.dispatchEvent(new CustomEvent('rating-switch-confirm', { detail: { mode } }));
            },
        }"
        {...{
            'x-on:rating-switch-open.window': 'prompt = { show: true, targetName: $event.detail.targetName, targetLevelCount: $event.detail.targetLevelCount, ratedCount: $event.detail.ratedCount, busy: false }',
            'x-on:rating-switch-done.window': 'close()',
        }}
    >
        <div
            x-show="prompt.show"
            x-cloak
            class="fixed inset-0 z-[70] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
        >
            <div
                x-on:click="cancel()"
                class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            ></div>
            <div class="relative w-full max-w-md rounded-lg bg-white dark:bg-slate-800 shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700">
                <div class="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                    <h3 class="text-[15px] font-bold tracking-tight text-slate-900 dark:text-slate-100">Switch rating system?</h3>
                </div>
                <div class="px-5 py-4 space-y-3 text-[13px] text-slate-700 dark:text-slate-300">
                    <p>
                        Target: <strong class="font-semibold text-slate-900 dark:text-slate-100" x-text="prompt.targetName"></strong>
                        <span x-text="' (' + prompt.targetLevelCount + ' levels)'" class="text-slate-500"></span>
                    </p>
                    <p>
                        Currently rated: <strong class="font-semibold text-slate-900 dark:text-slate-100 tabular-nums" x-text="prompt.ratedCount"></strong> items
                    </p>
                    <ul class="space-y-1.5 text-[12px] leading-relaxed text-slate-600 dark:text-slate-400 list-disc pl-5">
                        <li><strong>Remap by severity</strong> — each rating maps to a new level with the same bucket (good / marginal / significant). No bucket match = rating cleared.</li>
                        <li><strong>Clear all ratings</strong> — every item's rating is removed, regardless of bucket.</li>
                        <li>Notes, photos, and canned comments are <em>always</em> preserved.</li>
                    </ul>
                </div>
                <div class="px-5 py-3 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-700">
                    <button
                        type="button"
                        x-on:click="cancel()"
                        class="h-9 px-3 rounded-md text-[12px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    >Cancel</button>
                    <button
                        type="button"
                        x-on:click="confirm('clear')"
                        {...{ 'x-bind:disabled': "prompt.busy" }}
                        class="h-9 px-3 rounded-md text-[12px] font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/30 ring-1 ring-inset ring-rose-200 dark:ring-rose-800 hover:bg-rose-100 dark:hover:bg-rose-900/50 disabled:opacity-50 transition-colors"
                    >Clear all ratings</button>
                    <button
                        type="button"
                        x-on:click="confirm('remap')"
                        {...{ 'x-bind:disabled': "prompt.busy" }}
                        class="h-9 px-3 rounded-md text-[12px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >Remap by severity</button>
                </div>
            </div>
        </div>
    </div>
);

/**
 * Feature #20 phase 2b — add-section prompt modal.
 *
 * Mounted at page root alongside RatingSwitchConfirmModal so its overlay
 * isn't clipped by the settings sheet. Communicates with the editor via
 * window events:
 *   add-section-open    →  modal opens with empty title
 *   add-section-confirm {title}  →  editor patches snapshot
 *   add-section-done    →  modal closes (editor fires on success/error)
 */
export const AddSectionPromptModal = (): JSX.Element => (
    <div
        x-data="{
            show: false,
            title: '',
            busy: false,
            close() { this.show = false; this.title = ''; this.busy = false; },
            cancel() { this.close(); },
            submit() {
                if (this.busy) return;
                const t = (this.title || '').trim();
                if (!t) return;
                this.busy = true;
                window.dispatchEvent(new CustomEvent('add-section-confirm', { detail: { title: t } }));
            },
        }"
        {...{
            'x-on:add-section-open.window': 'show = true; title = ""; busy = false; $nextTick(() => $refs.titleInput?.focus())',
            'x-on:add-section-done.window':  'close()',
            'x-on:keydown.escape.window':    'show && cancel()',
        }}
    >
        <div
            x-show="show"
            x-cloak
            class="fixed inset-0 z-[70] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
        >
            <div
                x-on:click="cancel()"
                class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            ></div>
            <form
                {...{ 'x-on:submit.prevent': 'submit()' }}
                class="relative w-full max-w-md rounded-lg bg-white dark:bg-slate-800 shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700"
            >
                <div class="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                    <h3 class="text-[15px] font-bold tracking-tight text-slate-900 dark:text-slate-100">Add a section</h3>
                    <p class="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
                        Per-inspection only — the source template is unchanged.
                    </p>
                </div>
                <div class="px-5 py-4">
                    <label class="block">
                        <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Section title</span>
                        <input
                            type="text"
                            x-model="title"
                            x-ref="titleInput"
                            maxlength="50"
                            required
                            placeholder="e.g. Pool & Spa"
                            class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-[14px] font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                        />
                    </label>
                </div>
                <div class="px-5 py-3 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-700">
                    <button
                        type="button"
                        x-on:click="cancel()"
                        class="h-9 px-3 rounded-md text-[12px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    >Cancel</button>
                    <button
                        type="submit"
                        {...{ 'x-bind:disabled': "busy || !title.trim()" }}
                        class="h-9 px-3 rounded-md text-[12px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >Add section</button>
                </div>
            </form>
        </div>
    </div>
);

/**
 * Feature #20 phase 2c — generic destructive-confirm modal.
 *
 * One reusable confirmation surface for delete-section, delete-item,
 * save-back-to-template, and any future irreversible action. The opener
 * dispatches `confirm-danger-open` with a payload describing the dialog
 * (title, body, confirmText, eventName) and stashes context on the
 * editor; on confirm the modal fires the caller's eventName so each
 * action can route its own handler. No window.confirm.
 *
 * Event detail shape:
 *   { title: string, body: string[],  // bullet lines
 *     confirmText?: string,            // defaults to "Delete"
 *     confirmEvent: string,            // event name to fire on confirm
 *     tone?: 'danger' | 'warning' }    // styles the confirm button
 */
export const ConfirmDangerModal = (): JSX.Element => (
    <div
        x-data="{
            show: false,
            title: '',
            body: [],
            confirmText: 'Delete',
            confirmEvent: '',
            tone: 'danger',
            busy: false,
            close() { this.show = false; this.busy = false; },
            cancel() { this.close(); },
            confirm() {
                if (this.busy || !this.confirmEvent) return;
                this.busy = true;
                window.dispatchEvent(new CustomEvent(this.confirmEvent));
            },
        }"
        {...{
            'x-on:confirm-danger-open.window': 'show = true; busy = false; title = $event.detail.title || ""; body = $event.detail.body || []; confirmText = $event.detail.confirmText || "Delete"; confirmEvent = $event.detail.confirmEvent || ""; tone = $event.detail.tone || "danger"',
            'x-on:confirm-danger-done.window': 'close()',
            'x-on:keydown.escape.window': 'show && cancel()',
        }}
    >
        <div
            x-show="show"
            x-cloak
            class="fixed inset-0 z-[70] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
        >
            <div
                x-on:click="cancel()"
                class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            ></div>
            <div class="relative w-full max-w-md rounded-lg bg-white dark:bg-slate-800 shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700">
                <div class="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                    <h3 class="text-[15px] font-bold tracking-tight text-slate-900 dark:text-slate-100" x-text="title"></h3>
                </div>
                <div class="px-5 py-4">
                    <ul class="space-y-1.5 text-[13px] leading-relaxed text-slate-700 dark:text-slate-300 list-disc pl-5">
                        <template x-for="(line, i) in body" {...{ 'x-bind:key': 'i' }}>
                            <li x-text="line"></li>
                        </template>
                    </ul>
                </div>
                <div class="px-5 py-3 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-700">
                    <button
                        type="button"
                        x-on:click="cancel()"
                        class="h-9 px-3 rounded-md text-[12px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    >Cancel</button>
                    <button
                        type="button"
                        x-on:click="confirm()"
                        {...{ 'x-bind:disabled': "busy" }}
                        {...{ 'x-bind:class': "tone === 'warning' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-rose-600 hover:bg-rose-700'" }}
                        class="h-9 px-3 rounded-md text-[12px] font-bold text-white disabled:opacity-50 transition-colors"
                        x-text="confirmText"
                    ></button>
                </div>
            </div>
        </div>
    </div>
);

/**
 * Feature #20 phase 3 — save-as-new-template modal.
 *
 * Lets the inspector freeze the current per-inspection snapshot as a
 * brand-new template row in the tenant library. The new template
 * becomes available for future inspections via the standard template
 * picker. Source template (the one this inspection was originally
 * cloned from) is unchanged.
 */
export const SaveAsNewTemplateModal = (): JSX.Element => (
    <div
        x-data="{
            show: false,
            name: '',
            busy: false,
            close() { this.show = false; this.name = ''; this.busy = false; },
            cancel() { this.close(); },
            submit() {
                if (this.busy) return;
                const n = (this.name || '').trim();
                if (!n) return;
                this.busy = true;
                window.dispatchEvent(new CustomEvent('save-as-template-confirm', { detail: { name: n } }));
            },
        }"
        {...{
            'x-on:save-as-template-open.window': 'show = true; name = $event.detail?.suggestedName || ""; busy = false; $nextTick(() => $refs.nameInput?.focus())',
            'x-on:save-as-template-done.window': 'close()',
            'x-on:keydown.escape.window': 'show && cancel()',
        }}
    >
        <div
            x-show="show"
            x-cloak
            class="fixed inset-0 z-[70] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
        >
            <div
                x-on:click="cancel()"
                class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            ></div>
            <form
                {...{ 'x-on:submit.prevent': 'submit()' }}
                class="relative w-full max-w-md rounded-lg bg-white dark:bg-slate-800 shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700"
            >
                <div class="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                    <h3 class="text-[15px] font-bold tracking-tight text-slate-900 dark:text-slate-100">Save as new template</h3>
                    <p class="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
                        Freezes the current section + item structure (plus the rating system) into a new tenant template. Per-item ratings, notes, and photos on this inspection are NOT copied.
                    </p>
                </div>
                <div class="px-5 py-4">
                    <label class="block">
                        <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Template name</span>
                        <input
                            type="text"
                            x-model="name"
                            x-ref="nameInput"
                            maxlength="100"
                            required
                            placeholder="e.g. Coastal Properties — Standard"
                            class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-[14px] font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                        />
                    </label>
                </div>
                <div class="px-5 py-3 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-700">
                    <button
                        type="button"
                        x-on:click="cancel()"
                        class="h-9 px-3 rounded-md text-[12px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    >Cancel</button>
                    <button
                        type="submit"
                        {...{ 'x-bind:disabled': "busy || !name.trim()" }}
                        class="h-9 px-3 rounded-md text-[12px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >Save as template</button>
                </div>
            </form>
        </div>
    </div>
);

/**
 * Feature #20 phase 2b — add-item prompt modal.
 *
 * Same event-bridge pattern as AddSectionPromptModal. Receives
 * `add-item-open {sectionTitle}` to seed the dialog (the sectionId
 * is held by the editor's _pendingAddItemSectionId so the modal
 * doesn't need it), emits `add-item-confirm {label, type}` on submit.
 *
 * Item types mirror TemplateSchemaV2's discriminated union: rich (the
 * standard rated item with 3 canned-comment tabs) plus 8 non-rich data
 * collectors. We default to rich because that's what 90% of inspection
 * items are; the type-picker only matters when the inspector wants a
 * data point ("Year Built", "Foundation Type") rather than a rating.
 */
export const AddItemPromptModal = (): JSX.Element => (
    <div
        x-data="{
            show: false,
            label: '',
            type: 'rich',
            sectionTitle: '',
            busy: false,
            types: [
                { value: 'rich',         label: 'Rated item (with canned comments)' },
                { value: 'text',         label: 'Text field' },
                { value: 'textarea',     label: 'Long text' },
                { value: 'number',       label: 'Number' },
                { value: 'select',       label: 'Single choice' },
                { value: 'multi_select', label: 'Multi choice' },
                { value: 'boolean',      label: 'Yes / No' },
                { value: 'date',         label: 'Date' },
                { value: 'photo_only',   label: 'Photos only' },
            ],
            close() { this.show = false; this.label = ''; this.type = 'rich'; this.busy = false; },
            cancel() { this.close(); },
            submit() {
                if (this.busy) return;
                const l = (this.label || '').trim();
                if (!l) return;
                this.busy = true;
                window.dispatchEvent(new CustomEvent('add-item-confirm', { detail: { label: l, type: this.type } }));
            },
        }"
        {...{
            'x-on:add-item-open.window': 'show = true; label = ""; type = "rich"; busy = false; sectionTitle = $event.detail.sectionTitle || ""; $nextTick(() => $refs.labelInput?.focus())',
            'x-on:add-item-done.window': 'close()',
            'x-on:keydown.escape.window': 'show && cancel()',
        }}
    >
        <div
            x-show="show"
            x-cloak
            class="fixed inset-0 z-[70] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
        >
            <div
                x-on:click="cancel()"
                class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            ></div>
            <form
                {...{ 'x-on:submit.prevent': 'submit()' }}
                class="relative w-full max-w-md rounded-lg bg-white dark:bg-slate-800 shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700"
            >
                <div class="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                    <h3 class="text-[15px] font-bold tracking-tight text-slate-900 dark:text-slate-100">Add an item</h3>
                    <p class="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
                        Adding to <strong x-text="sectionTitle || 'this section'"></strong> — per-inspection only.
                    </p>
                </div>
                <div class="px-5 py-4 space-y-4">
                    <label class="block">
                        <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Item label</span>
                        <input
                            type="text"
                            x-model="label"
                            x-ref="labelInput"
                            maxlength="100"
                            required
                            placeholder="e.g. Pool Pump"
                            class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-[14px] font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                        />
                    </label>
                    <label class="block">
                        <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Item type</span>
                        <select
                            x-model="type"
                            class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-[14px] font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                        >
                            <template x-for="t in types" {...{ 'x-bind:key': 't.value' }}>
                                <option {...{ 'x-bind:value': 't.value' }} x-text="t.label"></option>
                            </template>
                        </select>
                        <p class="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                            Type is locked once the item is created. Pick "Rated item" for anything you want to mark Satisfactory / Defect; the rest collect a single data point.
                        </p>
                    </label>
                </div>
                <div class="px-5 py-3 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-700">
                    <button
                        type="button"
                        x-on:click="cancel()"
                        class="h-9 px-3 rounded-md text-[12px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    >Cancel</button>
                    <button
                        type="submit"
                        {...{ 'x-bind:disabled': "busy || !label.trim()" }}
                        class="h-9 px-3 rounded-md text-[12px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >Add item</button>
                </div>
            </form>
        </div>
    </div>
);
