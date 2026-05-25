/**
 * Design System 0520 subsystem E P3.2 — dashboard Filters modal.
 *
 * Three lightweight filters in one dialog:
 *   • Date range  — `inspection.date` between [from, to]
 *   • Agent       — exact `agentId` match (any buyer/listing agent)
 *   • Tags        — at least one of `tagIds`
 *
 * On Apply the modal broadcasts `filters-changed` (detail: { dateFrom,
 * dateTo, agentId, tagIds }) and the dashboard mirrors them into a
 * `filters` state used by the existing `_passesAllActiveFilters` chain.
 *
 * Listens for `open-filters` (no detail) to summon. ESC + backdrop
 * dismiss; `Reset` clears + applies an empty filter set in one click.
 */
import type { FC } from 'hono/jsx';

export const FiltersModal: FC = () => (
    <div
        x-data="filtersModal()"
        {...{
            '@open-filters.window':            'openModal()',
            'x-on:keydown.escape.window':      'open && close()',
            'x-on:click.self':                 'close()',
        }}
        x-show="open"
        style="display: none"
        class="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-6"
        role="dialog" aria-modal="true" aria-label="Filters"
    >
        <div class="max-w-md w-full p-6 bg-white rounded-xl shadow-2xl">
            <h2 class="text-xl font-bold mb-4">Filters</h2>

            <label class="block mb-3">
                <span class="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Date range</span>
                <div class="flex gap-2">
                    <input class="flex-1 px-2 py-1 border border-slate-200 rounded text-sm"
                           type="date" {...{ 'x-model': 'dateFrom' }} />
                    <input class="flex-1 px-2 py-1 border border-slate-200 rounded text-sm"
                           type="date" {...{ 'x-model': 'dateTo' }} />
                </div>
            </label>

            <label class="block mb-3">
                <span class="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Agent</span>
                <select class="w-full px-2 py-1 border border-slate-200 rounded text-sm"
                        {...{ 'x-model': 'agentId' }}>
                    <option value="">Any</option>
                    <template {...{ 'x-for': 'a in agents', ':key': 'a.id' }}>
                        <option {...{ ':value': 'a.id', 'x-text': 'a.name || a.email' }} />
                    </template>
                </select>
            </label>

            <label class="block mb-3">
                <span class="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Tags</span>
                <div class="flex flex-wrap gap-1">
                    <template {...{ 'x-for': 't in tags', ':key': 't.id' }}>
                        <label class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 text-xs font-medium cursor-pointer">
                            <input type="checkbox" {...{ ':value': 't.id', 'x-model': 'tagIds' }} class="w-3 h-3" />
                            <span x-text="t.name" />
                        </label>
                    </template>
                    <p class="text-xs text-slate-400" x-show="tags.length === 0">No tags yet.</p>
                </div>
            </label>

            <footer class="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button class="px-3 h-9 rounded-md text-sm text-slate-500 hover:text-rose-600"
                        {...{ '@click': 'reset()' }}>Reset</button>
                <button class="px-3 h-9 rounded-md border border-slate-200 text-sm font-medium hover:bg-slate-50"
                        {...{ '@click': 'close()' }}>Cancel</button>
                <button class="px-3 h-9 rounded-md bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700"
                        {...{ '@click': 'apply()' }}>Apply</button>
            </footer>
        </div>
    </div>
);
