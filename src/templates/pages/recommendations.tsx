import { MainLayout } from '../layouts/main-layout';
import { Modal, ModalFooter } from '../components/modal';
import { BrandingConfig } from '../../types/auth';
import { PageHeader } from '../components/page-header';

interface Props { branding?: BrandingConfig; }

export const RecommendationsPage = ({ branding }: Props): JSX.Element => (
    <MainLayout title="Repair Items Library" branding={branding}>
        <div x-data="recommendationsLibrary" x-init="init()" class="space-y-6">
            <PageHeader
                eyebrow="LIBRARY · REPAIR ITEMS"
                eyebrowColor="slate"
                title="Repair Items"
                meta={
                    <span x-text="`${items?.length || 0} repair item${(items?.length || 0) === 1 ? '' : 's'}${(distinctCategories?.length || 0) ? ' across ' + distinctCategories.length + ' categor' + (distinctCategories.length === 1 ? 'y' : 'ies') : ''}`"></span>
                }
                actions={
                    <div class="flex items-center gap-2 print:hidden">
                        <button
                            x-show="items.length === 0"
                            x-on:click="seedDefaults()"
                            {...{ 'x-bind:disabled': 'loading' }}
                            class="h-8 px-3 rounded-md bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[13px] font-bold hover:bg-indigo-200 dark:hover:bg-indigo-900/60 disabled:opacity-50 transition-all"
                        >
                            Seed defaults (80)
                        </button>
                        {/* Sub-spec D Task 6 — Print as PDF. Uses window.print() +
                            @media print rules in input.css to render a clean table. */}
                        <button
                            type="button"
                            onclick="window.print()"
                            aria-label="Print recommendations as PDF"
                            class="h-8 px-4 rounded-md bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-[13px] font-bold inline-flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        >
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
                            Print as PDF
                        </button>
                        <button
                            x-on:click="openCreate()"
                            class="h-8 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 active:scale-95 transition-all inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                        >
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                            Add repair item
                        </button>
                    </div>
                }
            />

            <div class="flex gap-3 flex-wrap print:hidden">
                <select x-model="categoryFilter" x-on:change="reload()" class="px-3 py-2 rounded-lg border border-slate-200 text-sm">
                    <option value="">All categories</option>
                    <template x-for="cat in distinctCategories" {...{ 'x-bind:key': 'cat' }}>
                        <option x-bind:value="cat" x-text="cat"></option>
                    </template>
                </select>
                <select x-model="severityFilter" x-on:change="reload()" class="px-3 py-2 rounded-lg border border-slate-200 text-sm">
                    <option value="">All severities</option>
                    <option value="satisfactory">Satisfactory</option>
                    <option value="monitor">Monitor</option>
                    <option value="defect">Defect</option>
                </select>
            </div>

            <div x-show="items.length === 0 && !loading" class="text-center py-12 bg-slate-50 dark:bg-slate-800/50 rounded-md">
                <p class="text-slate-500 dark:text-slate-400 font-semibold">No recommendations yet.</p>
                <p class="text-slate-400 dark:text-slate-500 text-sm mt-2">Click "Seed defaults" above to load 80 starter entries, or add your own.</p>
            </div>

            <div x-show="items.length > 0" class="grid grid-cols-1 md:grid-cols-2 gap-3 print:hidden">
                <template x-for="rec in items" {...{ 'x-bind:key': 'rec.id' }}>
                    <div class="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm hover:shadow-md transition">
                        <div class="flex items-start justify-between gap-3">
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2 mb-1">
                                    <span class="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full" x-bind:class="severityClass(rec.severity)" x-text="rec.severity"></span>
                                    <span class="text-xs text-slate-500" x-text="rec.category || '(no category)'"></span>
                                </div>
                                <p class="font-bold text-slate-900" x-text="rec.name"></p>
                                <p class="text-xs text-slate-500 mt-1 line-clamp-2" x-text="rec.defaultRepairSummary"></p>
                                <p class="text-xs text-slate-400 mt-1" x-text="estimateLabel(rec)"></p>
                            </div>
                            <div class="flex flex-col gap-1">
                                <button x-on:click="openEdit(rec)" class="text-xs text-indigo-600 hover:underline">Edit</button>
                                <button x-on:click="confirmDelete(rec)" class="text-xs text-rose-600 hover:underline">Delete</button>
                            </div>
                        </div>
                    </div>
                </template>
            </div>

            {/* Sub-spec D Task 6 — Print-only table view. Hidden on screen,
                rendered as a clean tabular list when the user hits Print
                (CSS rules in input.css @media print scope). Uses Alpine
                template loop so it always reflects the current filtered
                result set. */}
            <div x-show="items.length > 0" class="hidden print:block">
                <table class="recommendations-print-table">
                    <thead>
                        <tr>
                            <th>Priority</th>
                            <th>Category</th>
                            <th>Item</th>
                            <th>Estimate</th>
                            <th>Recommended action</th>
                        </tr>
                    </thead>
                    <tbody>
                        <template x-for="rec in items" {...{ 'x-bind:key': 'rec.id' }}>
                            <tr>
                                <td x-bind:class="rec.severity === 'defect' ? 'priority-safety' : rec.severity === 'monitor' ? 'priority-rec' : 'priority-maint'" x-text="rec.severity"></td>
                                <td x-text="rec.category || '—'"></td>
                                <td x-text="rec.name"></td>
                                <td x-text="estimateLabel(rec)"></td>
                                <td x-text="rec.defaultRepairSummary"></td>
                            </tr>
                        </template>
                    </tbody>
                </table>
            </div>

            {/* Create / Edit modal */}
            <Modal
                name="modalOpen"
                titleExpr="editingId ? 'Edit recommendation' : 'New recommendation'"
                size="lg"
                footer={
                    <ModalFooter
                        onCancel="modalOpen = false"
                        onConfirm="save()"
                        confirmDisabled="saving"
                        confirmTextExpr="saving ? 'Saving...' : 'Save'"
                    />
                }
            >
                <div class="space-y-3">
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">Category</label>
                            <input
                                type="text"
                                list="recCategoryOptions"
                                x-model="form.category"
                                placeholder="e.g., Roof"
                                autocomplete="off"
                                class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                            />
                            <datalist id="recCategoryOptions">
                                <template x-for="cat in distinctCategories" {...{ 'x-bind:key': 'cat' }}>
                                    <option x-bind:value="cat"></option>
                                </template>
                            </datalist>
                            <p class="text-[10px] text-slate-400 mt-1">Pick from your existing categories or type a new one.</p>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">Name (short title)</label>
                            <input type="text" x-model="form.name" required placeholder="e.g., Active roof leak" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">Severity</label>
                            <select x-model="form.severity" required class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm">
                                <option value="satisfactory">Satisfactory</option>
                                <option value="monitor">Monitor</option>
                                <option value="defect">Defect</option>
                            </select>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-xs font-bold text-slate-600 mb-1">Estimate min ($)</label>
                                <input type="number" {...{'x-model.number': 'form.estimateMinDollars'}} min="0" placeholder="800" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-600 mb-1">Estimate max ($)</label>
                                <input type="number" {...{'x-model.number': 'form.estimateMaxDollars'}} min="0" placeholder="2500" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                            </div>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">Repair summary</label>
                            <textarea x-model="form.defaultRepairSummary" required rows={4} placeholder="Recommend evaluation by licensed contractor..." class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"></textarea>
                        </div>
                </div>
            </Modal>
        </div>

        <script src="/js/auth.js"></script>
        <script src="/js/toast.js"></script>
        <script type="module" src="/js/recommendations-library.js"></script>
    </MainLayout>
);
