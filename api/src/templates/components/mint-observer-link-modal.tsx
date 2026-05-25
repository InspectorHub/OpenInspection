/**
 * Design System 0520 subsystem D phase 5 task 5.2 — mint observer link.
 *
 * Inspector-facing modal that POSTs to /api/inspections/:id/observer-links
 * and surfaces the generated `/observe/:token` URL for copy / share.
 * Listens for `@open-mint-observer.window` so any toolbar button can
 * fire `$dispatch('open-mint-observer')` to summon it without prop
 * drilling.
 *
 * The Alpine factory lives in /js/mint-observer-link-modal.js. Mount
 * the modal once per page that loads that script.
 */
import type { FC } from 'hono/jsx';

export const MintObserverLinkModal: FC = () => (
    <div
        x-data="mintObserverLink()"
        {...{ '@open-mint-observer.window': 'openModal()' }}
        x-show="open"
        style="display: none"
        class="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-6"
        role="dialog" aria-modal="true" aria-label="Share live view"
    >
        <div class="max-w-md w-full p-6 bg-white rounded-xl shadow-2xl">
            <h2 class="text-xl font-bold mb-2">Share live view</h2>
            <p class="text-sm text-slate-500 mb-4">
                Generate a one-time read-only link a buyer or agent can use
                to watch this inspection live. No account needed.
            </p>

            <label class="block mb-4">
                <span class="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Duration</span>
                <select class="w-full px-3 py-2 border border-slate-200 rounded-md text-sm font-medium"
                        {...{ 'x-model.number': 'durationSeconds' }}>
                    <option value="3600">1 hour</option>
                    <option value="86400">1 day</option>
                    <option value="604800">7 days (default)</option>
                </select>
            </label>

            <div x-show="generatedUrl"
                 class="p-3 mb-4 bg-emerald-50 border border-emerald-200 rounded-md space-y-2">
                <div class="text-[10px] font-bold uppercase tracking-widest text-emerald-800">Live-view link (one-time)</div>
                <input class="w-full px-2 py-1 border border-emerald-300 rounded text-xs font-mono"
                       {...{ ':value': 'generatedUrl', 'readonly': true, '@click': '$el.select()' }} />
                <div class="flex gap-2">
                    <button class="px-3 h-7 rounded-md bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700"
                            {...{ '@click': 'copy()' }}>Copy link</button>
                    <span class="text-xs text-emerald-700 self-center" x-show="copied">Copied!</span>
                </div>
            </div>

            <p class="text-xs text-rose-600 mb-3" x-show="error" x-text="error" />

            <div class="flex justify-end gap-2">
                <button class="px-3 h-9 rounded-md border border-slate-200 text-sm font-medium hover:bg-slate-50"
                        {...{ '@click': 'close()' }}>Close</button>
                <button class="px-3 h-9 rounded-md bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 disabled:opacity-50"
                        x-show="!generatedUrl"
                        {...{ '@click': 'mint()', ':disabled': 'submitting' }}>
                    Generate link
                </button>
            </div>
        </div>
    </div>
);
