/**
 * Round-2 backlog #2 — Customize Columns modal (Spectora §5.1 / §E.7).
 *
 * Driven by the Alpine `dashboardColumns` factory in dashboard.js. The factory
 * owns:
 *   - `columns`     : array of `{ id, label, defaultOn, alwaysOn, mobileVisible, description }`
 *   - `selected`    : reactive Set of currently-visible column ids
 *   - `isVisible(id)`     : returns true if column should render in row
 *   - `toggle(id)`        : flip a column on/off (no-op for always-on)
 *   - `saveColumns()`     : persists to localStorage + PATCHes the tenant default
 *
 * The modal uses the static-mode driver (`id="customizeColumnsModal"`). Click
 * "Customize Columns" toolbar button calls `openCustomizeColumnsModal()`,
 * which removes `.hidden` from the modal root. The Alpine state is held on
 * the modal root itself via `x-data="dashboardColumns"`.
 */

import { Modal } from './modal';
import { DASHBOARD_COLUMNS } from '../../lib/dashboard-columns';

export const CustomizeColumnsModal = (): JSX.Element => (
    <div x-data="dashboardColumns" x-init="initColumns()">
        <Modal
            id="customizeColumnsModal"
            title="Customize Columns"
            subtitle="Pick what shows in your inspection list. Saved as the team default."
            size="lg"
            footer={
                <>
                    <button
                        type="button"
                        x-on:click="resetColumns()"
                        class="h-10 px-4 rounded-xl border bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-200 border-slate-200 dark:border-slate-600 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-600 transition-all"
                    >
                        Reset to defaults
                    </button>
                    <div class="flex-1"></div>
                    <button
                        type="button"
                        onclick="document.getElementById('customizeColumnsModal')?.classList.add('hidden')"
                        class="h-10 px-4 rounded-xl border bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-200 border-slate-200 dark:border-slate-600 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-600 transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        x-on:click="saveColumns()"
                        x-bind:disabled="saving"
                        class="h-10 px-4 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all"
                    >
                        <span x-text="saving ? 'Saving…' : 'Save'"></span>
                    </button>
                </>
            }
        >
            <div class="space-y-2" data-test="customize-columns-list">
                {DASHBOARD_COLUMNS.map((col) => (
                    <label
                        key={col.id}
                        class={`flex items-start gap-3 p-3 rounded-md border transition-all ${col.alwaysOn ? 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 cursor-not-allowed' : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 hover:border-indigo-300 dark:hover:border-indigo-500 cursor-pointer'}`}
                        data-column-id={col.id}
                    >
                        <input
                            type="checkbox"
                            value={col.id}
                            disabled={col.alwaysOn ? true : undefined}
                            x-bind:checked={`isVisible('${col.id}')`}
                            x-on:change={`toggle('${col.id}')`}
                            class="mt-0.5 w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50"
                        />
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2">
                                <span class="text-sm font-bold text-slate-900 dark:text-slate-100">{col.label}</span>
                                {col.alwaysOn && (
                                    <span class="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-300 bg-slate-100 dark:bg-slate-600 px-1.5 py-0.5 rounded">Required</span>
                                )}
                                {col.mobileVisible === false && (
                                    <span class="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-300 bg-slate-100 dark:bg-slate-600 px-1.5 py-0.5 rounded" title="Hidden on mobile to keep cards readable">Desktop only</span>
                                )}
                            </div>
                            {col.description && (
                                <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{col.description}</p>
                            )}
                        </div>
                    </label>
                ))}
            </div>
            <p
                x-show="error"
                x-cloak
                class="mt-3 text-xs font-semibold text-rose-600"
                x-text="error"
            ></p>
        </Modal>
    </div>
);
