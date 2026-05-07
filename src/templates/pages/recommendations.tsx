import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

interface Props { branding?: BrandingConfig; }

export const RecommendationsPage = ({ branding }: Props): JSX.Element => (
    <MainLayout title="Recommendations Library" branding={branding}>
        <div x-data="recommendationsLibrary" x-init="init()" class="space-y-4">
            <header class="flex items-start justify-between flex-wrap gap-4">
                <div>
                    <h1 class="text-xl font-bold text-slate-900 tracking-tight">Recommendations Library</h1>
                    <p class="text-sm text-slate-500 mt-1">Pre-written repair recommendations with estimate ranges. Inspectors attach these to inspection items by clicking chips.</p>
                </div>
                <div class="flex gap-3">
                    <button x-show="items.length === 0" x-on:click="seedDefaults()" {...{ 'x-bind:disabled': 'loading' }} class="px-5 py-2 rounded-xl bg-indigo-100 text-indigo-700 text-xs font-bold uppercase tracking-widest hover:bg-indigo-200 disabled:opacity-50">Seed defaults (80)</button>
                    <button x-on:click="openCreate()" class="px-5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold uppercase tracking-widest hover:bg-black">+ Add recommendation</button>
                </div>
            </header>

            <div class="flex gap-3 flex-wrap">
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

            <div x-show="items.length === 0 && !loading" class="text-center py-12 bg-slate-50 rounded-2xl">
                <p class="text-slate-500 font-semibold">No recommendations yet.</p>
                <p class="text-slate-400 text-sm mt-2">Click "Seed defaults" above to load 80 starter entries, or add your own.</p>
            </div>

            <div x-show="items.length > 0" class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <template x-for="rec in items" {...{ 'x-bind:key': 'rec.id' }}>
                    <div class="p-4 bg-white border border-slate-200 rounded-lg shadow-sm hover:shadow-md transition">
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

            {/* Create / Edit modal */}
            <div x-show="modalOpen" x-cloak class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" {...{ 'x-on:click': 'if ($event.target === $el) modalOpen = false' }}>
                <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6">
                    <h2 class="text-lg font-bold text-slate-900 mb-4" x-text="editingId ? 'Edit recommendation' : 'New recommendation'"></h2>
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
                    <div class="flex gap-3 justify-end mt-6">
                        <button x-on:click="modalOpen = false" class="px-5 py-2 rounded-lg ring-2 ring-slate-300 text-slate-700 text-xs font-bold">Cancel</button>
                        <button x-on:click="save()" {...{ 'x-bind:disabled': 'saving' }} class="px-5 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold uppercase tracking-widest hover:bg-black disabled:opacity-50">
                            <span x-text="saving ? 'Saving...' : 'Save'"></span>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <script src="/js/auth.js"></script>
        <script src="/js/toast.js"></script>
        <script type="module" src="/js/recommendations-library.js"></script>
    </MainLayout>
);
