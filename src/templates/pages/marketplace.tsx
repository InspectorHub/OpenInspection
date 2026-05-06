import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

export const MarketplacePage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout title={`${siteName} | Marketplace`} branding={branding}>
            <div class="space-y-8 animate-fade-in" x-data="marketplace()">
                {/* Header */}
                <div class="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <span class="inline-flex items-center rounded-lg bg-violet-600/10 px-3 py-1 text-[10px] font-black text-violet-600 uppercase tracking-[0.2em] ring-1 ring-inset ring-violet-600/20 mb-4">Template Marketplace</span>
                        <h1 class="text-5xl font-black tracking-tight text-slate-900">Marketplace</h1>
                        <p class="text-lg text-slate-500 font-semibold mt-2">Browse and import community inspection templates.</p>
                    </div>
                </div>

                {/* Filters */}
                <div class="flex flex-col sm:flex-row gap-3">
                    <input type="text" x-model="search" {...{ 'x-on:input.debounce.300ms': 'load()' }}
                        placeholder="Search templates..."
                        class="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500" />
                    <select x-model="category" x-on:change="load()"
                        class="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500">
                        <option value="">All Categories</option>
                        <option value="residential">Residential</option>
                        <option value="commercial">Commercial</option>
                        <option value="trec">TREC</option>
                        <option value="condo">Condo</option>
                        <option value="new_construction">New Construction</option>
                    </select>
                    {/* Polish 5 — client-side sort */}
                    <select x-model="sort" x-on:change="resort()"
                        class="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500">
                        <option value="featured">Featured first</option>
                        <option value="recent">Recently added</option>
                        <option value="popular">Most imports</option>
                        <option value="name">Name (A-Z)</option>
                    </select>
                </div>

                {/* Grid */}
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <template x-for="t in templates" {...{ 'x-bind:key': 't.id' }}>
                        <div class="glass-panel rounded-2xl p-6 flex flex-col gap-4 hover:shadow-lg transition" x-bind:class="t.featured ? 'ring-2 ring-amber-400/60' : ''">
                            <div class="flex items-start justify-between">
                                <div>
                                    <div class="flex items-center gap-2">
                                        <h3 class="font-black text-slate-900 text-lg" x-text="t.name"></h3>
                                        <span x-show="t.featured" class="text-[10px] font-black uppercase tracking-widest text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">★ Featured</span>
                                    </div>
                                    <div class="flex items-center gap-2 mt-1">
                                        <span class="text-xs font-bold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full capitalize" x-text="t.category.replace('_',' ')"></span>
                                        <span class="text-xs text-slate-400 font-mono" x-text="'v' + t.semver"></span>
                                    </div>
                                </div>
                            </div>
                            <p class="text-sm text-slate-500" x-text="t.changelog || 'Standard inspection template.'"></p>
                            <div class="flex items-center justify-between mt-auto pt-2 border-t border-slate-100 gap-2">
                                <span class="text-xs text-slate-400" x-text="t.downloadCount + ' imports'"></span>
                                <div class="flex items-center gap-2">
                                    {/* Polish 5 — Preview button */}
                                    <button x-on:click="openPreview(t)" class="text-xs text-violet-600 font-bold hover:underline">Preview</button>
                                    <template x-if="!t.importedSemver">
                                        <button x-on:click="importTemplate(t.id)"
                                            class="px-4 py-1.5 rounded-xl bg-violet-600 text-white text-xs font-bold hover:bg-violet-700 transition">
                                            Import
                                        </button>
                                    </template>
                                    <template x-if="t.importedSemver && !t.hasUpdate">
                                        <span class="px-4 py-1.5 rounded-xl bg-slate-100 text-slate-400 text-xs font-bold">Imported</span>
                                    </template>
                                    <template x-if="t.hasUpdate">
                                        <button x-on:click="importTemplate(t.id)"
                                            class="px-4 py-1.5 rounded-xl bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 transition">
                                            Update available
                                        </button>
                                    </template>
                                </div>
                            </div>
                        </div>
                    </template>
                    <template x-if="templates.length === 0 && !loading">
                        <div class="col-span-3 py-16 text-center text-slate-400 font-semibold">No templates found. Try a different search or category.</div>
                    </template>
                    <template x-if="loading">
                        <div class="col-span-3 py-16 text-center text-slate-400 font-semibold">Loading...</div>
                    </template>
                </div>

                {/* Pagination */}
                <div class="flex items-center justify-center gap-3" x-show="totalPages > 1">
                    <button x-on:click="prevPage()" x-bind:disabled="page <= 1"
                        class="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold disabled:opacity-40">Prev</button>
                    <span class="text-sm text-slate-600 font-semibold" x-text="`Page ${page} of ${totalPages}`"></span>
                    <button x-on:click="nextPage()" x-bind:disabled="page >= totalPages"
                        class="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold disabled:opacity-40">Next</button>
                </div>

                {/* Polish 5 — Preview modal. NOTE: NO x-cloak here — Alpine doesn't auto-remove
                    x-cloak from descendant elements, so combining it with main-layout's
                    [x-cloak] { display: none !important } would permanently hide the modal even
                    when previewOpen=true. x-show alone correctly toggles display. */}
                <div x-show="previewOpen" style="display:none" x-transition class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" {...{ 'x-on:click.self': 'previewOpen = false' }}>
                    <div class="bg-white rounded-3xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col">
                        <header class="px-8 py-5 border-b border-slate-100 flex items-center justify-between">
                            <div>
                                <h2 class="text-xl font-black text-slate-900" x-text="previewTemplate?.name || 'Preview'"></h2>
                                <p class="text-xs text-slate-500" x-text="previewTemplate?.changelog || ''"></p>
                            </div>
                            <button x-on:click="previewOpen = false" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
                        </header>
                        <div class="flex-1 overflow-y-auto p-6 space-y-3">
                            <p class="text-xs font-bold uppercase tracking-widest text-slate-400">
                                <span x-text="previewSchema?.sections?.length || 0"></span> sections ·
                                <span x-text="previewItemCount"></span> items total
                            </p>
                            <template x-for="sec in (previewSchema?.sections || [])" {...{ 'x-bind:key': 'sec.id' }}>
                                <details class="bg-slate-50 rounded-xl p-3">
                                    <summary class="cursor-pointer font-bold text-sm text-slate-800 flex items-center justify-between">
                                        <span x-text="sec.title || sec.name || sec.id"></span>
                                        <span class="text-xs text-slate-400" x-text="(sec.items?.length || 0) + ' items'"></span>
                                    </summary>
                                    <ul class="mt-2 space-y-0.5 text-xs text-slate-600 pl-3">
                                        <template x-for="it in (sec.items || [])" {...{ 'x-bind:key': 'it.id' }}>
                                            <li class="flex items-center gap-2">
                                                <span class="w-1 h-1 rounded-full bg-slate-300"></span>
                                                <span x-text="it.label || it.name || it.id"></span>
                                            </li>
                                        </template>
                                    </ul>
                                </details>
                            </template>
                        </div>
                        <footer class="px-8 py-4 border-t border-slate-100 flex items-center justify-end gap-3">
                            <button x-on:click="previewOpen = false" class="px-4 py-2 rounded-lg ring-2 ring-slate-200 text-slate-600 text-xs font-bold">Close</button>
                            <button x-show="previewTemplate && !previewTemplate.importedSemver"
                                x-on:click="importTemplate(previewTemplate.id); previewOpen = false"
                                class="px-4 py-2 rounded-lg bg-violet-600 text-white text-xs font-bold">
                                Import this template
                            </button>
                        </footer>
                    </div>
                </div>

                {/* Toast */}
                <div x-show="toast" x-transition class="fixed bottom-6 right-6 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-xl flex items-center gap-3 z-50">
                    <span x-text="toast"></span>
                    <a x-show="toastLink" x-bind:href="toastLink" class="text-violet-400 font-bold text-sm underline">View</a>
                </div>
            </div>

            <script src="/js/auth.js"></script>
            <script src="/js/marketplace.js"></script>
        </MainLayout>
    );
};
