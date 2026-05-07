import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

export const MarketplacePage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout title={`${siteName} | Marketplace`} branding={branding}>
            <div class="space-y-4 animate-fade-in" x-data="marketplace()">
                {/* Header */}
                <div class="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <span class="inline-flex items-center rounded-lg bg-violet-600/10 px-3 py-1 text-[10px] font-bold text-violet-600 uppercase tracking-[0.2em] ring-1 ring-inset ring-violet-600/20 mb-4">Template Marketplace</span>
                        <h1 class="text-3xl font-bold tracking-tight text-slate-900">Marketplace</h1>
                        <p class="text-lg text-slate-500 font-semibold mt-2">Browse and import community inspection templates.</p>
                        {/* R7-25: Spell out the import / update relationship so
                            inspectors aren't unsure whether importing creates a
                            copy they own or links to a remote template. */}
                        <div class="mt-3 inline-flex items-start gap-2 px-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 max-w-2xl">
                            <svg class="w-4 h-4 mt-0.5 flex-shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                            <div>
                                <strong>Import = your own copy.</strong> When the publisher updates the template, you'll see "Update available" and can pull the new version (or keep your customizations).
                            </div>
                        </div>
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

                {/* Spec 5G M2 — Library packs (comments / snippets). Render
                    only when at least one library is published. */}
                <div x-show="libraries.length > 0" class="mt-2 mb-6">
                    <h2 class="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Comment & Snippet Libraries</h2>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <template x-for="l in libraries" {...{ 'x-bind:key': 'l.id' }}>
                            <div class="glass-panel rounded-2xl p-6 flex flex-col gap-4 hover:shadow-lg transition" x-bind:class="l.featured ? 'ring-2 ring-amber-400/60' : ''">
                                <div class="flex items-start justify-between">
                                    <div>
                                        <div class="flex items-center gap-2">
                                            <h3 class="font-bold text-slate-900 text-lg" x-text="l.name"></h3>
                                            <span x-show="l.featured" class="text-[10px] font-bold uppercase tracking-widest text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">★ Featured</span>
                                        </div>
                                        <div class="flex items-center gap-2 mt-1">
                                            <span class="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full capitalize" x-text="l.kind"></span>
                                            <span class="text-xs text-slate-400 font-mono" x-text="'v' + l.semver"></span>
                                            <span class="text-xs text-slate-500" x-text="l.itemCount + ' entries'"></span>
                                        </div>
                                    </div>
                                </div>
                                <p class="text-sm text-slate-500" x-text="l.changelog || 'Standard library pack.'"></p>
                                <div class="flex items-center justify-between mt-auto">
                                    <span class="text-[11px] text-slate-400" x-text="l.downloadCount + ' imports'"></span>
                                    {/* Round 37 — split button by state so Update routes through the confirm modal. */}
                                    <template x-if="!l.importedSemver">
                                        <button x-on:click="importLibrary(l.id)"
                                            class="px-4 py-1.5 text-sm rounded-md font-bold transition bg-indigo-600 text-white hover:bg-indigo-700">
                                            Import
                                        </button>
                                    </template>
                                    <template x-if="l.importedSemver && !l.hasUpdate">
                                        <span class="px-4 py-1.5 text-sm rounded-md font-bold bg-slate-100 text-slate-400">Imported</span>
                                    </template>
                                    <template x-if="l.hasUpdate">
                                        <button x-on:click="openUpdateConfirm(l, 'library')"
                                            class="px-4 py-1.5 text-sm rounded-md font-bold transition bg-amber-500 text-white hover:bg-amber-600"
                                            x-text="'Update to v' + l.semver"></button>
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </div>

                {/* Templates header — only when libraries also rendered above */}
                <h2 x-show="libraries.length > 0" class="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3 mt-2">Inspection Templates</h2>

                {/* Grid */}
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <template x-for="t in templates" {...{ 'x-bind:key': 't.id' }}>
                        <div class="glass-panel rounded-2xl p-6 flex flex-col gap-4 hover:shadow-lg transition" x-bind:class="t.featured ? 'ring-2 ring-amber-400/60' : ''">
                            <div class="flex items-start justify-between">
                                <div>
                                    <div class="flex items-center gap-2">
                                        <h3 class="font-black text-slate-900 text-lg" x-text="t.name"></h3>
                                        <span x-show="t.featured" class="text-[10px] font-bold uppercase tracking-widest text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">★ Featured</span>
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
                                    {/* Round 37 — Update flow (Scheme 2). Opens a confirm
                                        modal explaining "creates a new copy" before POSTing. */}
                                    <template x-if="t.hasUpdate">
                                        <button x-on:click="openUpdateConfirm(t, 'template')"
                                            class="px-4 py-1.5 rounded-xl bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 transition"
                                            x-text="'Update to v' + t.semver"></button>
                                    </template>
                                </div>
                            </div>
                        </div>
                    </template>
                    <template x-if="templates.length === 0 && !loading">
                        <div class="col-span-3 py-10 text-center text-slate-400 font-semibold">No templates found. Try a different search or category.</div>
                    </template>
                    <template x-if="loading">
                        <div class="col-span-3 py-10 text-center text-slate-400 font-semibold">Loading...</div>
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
                    <div class="bg-white rounded-lg shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col">
                        <header class="px-8 py-5 border-b border-slate-100 flex items-center justify-between">
                            <div>
                                <h2 class="text-xl font-black text-slate-900" x-text="previewTemplate?.name || 'Preview'"></h2>
                                <p class="text-xs text-slate-500" x-text="previewTemplate?.changelog || ''"></p>
                            </div>
                            <button x-on:click="previewOpen = false" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
                        </header>
                        <div class="flex-1 overflow-y-auto p-6 space-y-3">
                            {/* Spec 5B P3 — totals row: items, canned comments, defects */}
                            <p class="text-xs font-bold uppercase tracking-widest text-slate-400">
                                <span x-text="previewSchema?.sections?.length || 0"></span> sections ·
                                <span x-text="previewItemCount"></span> items ·
                                <span x-text="previewCannedTotal"></span> canned comments ·
                                <span class="text-rose-500" x-text="previewDefectTotal + ' defects'"></span>
                            </p>
                            <template x-for="sec in (previewSchema?.sections || [])" {...{ 'x-bind:key': 'sec.id' }}>
                                <details class="bg-slate-50 rounded-xl p-3" open>
                                    <summary class="cursor-pointer font-bold text-sm text-slate-800 flex items-center justify-between">
                                        <span x-text="sec.title || sec.name || sec.id"></span>
                                        <span class="text-xs text-slate-400" x-text="(sec.items?.length || 0) + ' items'"></span>
                                    </summary>
                                    <ul class="mt-2 space-y-1 text-xs text-slate-600 pl-3">
                                        <template x-for="it in (sec.items || [])" {...{ 'x-bind:key': 'it.id' }}>
                                            <li class="flex items-center gap-2 flex-wrap py-1">
                                                <span class="w-1 h-1 rounded-full bg-slate-300"></span>
                                                <span class="font-semibold text-slate-700" x-text="it.label || it.name || it.id"></span>
                                                {/* Spec 5B P3 — rating type pill */}
                                                <span class="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-200 text-slate-600" x-text="it.type || 'rich'"></span>
                                                {/* Tab counts (info / lim / def). Only render
                                                    when the template ships any canned content. */}
                                                <span x-show="it._info > 0" class="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded" x-text="'info: ' + it._info"></span>
                                                <span x-show="it._lim > 0" class="text-[10px] font-mono text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded" x-text="'lim: ' + it._lim"></span>
                                                <span x-show="it._def > 0" class="text-[10px] font-mono text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded" x-text="'def: ' + it._def"></span>
                                            </li>
                                        </template>
                                    </ul>
                                </details>
                            </template>
                        </div>
                        <footer class="px-4 py-2 border-t border-slate-100 flex items-center justify-end gap-3">
                            <button x-on:click="previewOpen = false" class="px-4 py-2 rounded-lg ring-2 ring-slate-200 text-slate-600 text-xs font-bold">Close</button>
                            <button x-show="previewTemplate && !previewTemplate.importedSemver"
                                x-on:click="importTemplate(previewTemplate.id); previewOpen = false"
                                class="px-4 py-2 rounded-lg bg-violet-600 text-white text-xs font-bold">
                                Import this template
                            </button>
                        </footer>
                    </div>
                </div>

                {/* Round 37 — Update confirm modal. Explains the "new copy"
                    semantics (Scheme 2) so the inspector knows their existing
                    template/library entries are preserved. */}
                <div x-show="updateConfirmOpen" style="display:none" x-transition class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" {...{ 'x-on:click.self': 'closeUpdateConfirm()' }}>
                    <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
                        <header class="px-6 py-4 border-b border-slate-100">
                            <h2 class="text-lg font-black text-slate-900">
                                <span x-text="updateKind === 'library' ? 'Update library?' : 'Update template?'"></span>
                            </h2>
                        </header>
                        <div class="px-6 py-5 space-y-3 text-sm text-slate-700">
                            <p>
                                <strong x-text="updateTarget?.name || ''"></strong>
                                <span class="text-slate-500"> will move from </span>
                                <span class="font-mono text-xs text-slate-700" x-text="'v' + (updateTarget?.importedSemver || '?')"></span>
                                <span class="text-slate-500"> to </span>
                                <span class="font-mono text-xs font-bold text-amber-700" x-text="'v' + (updateTarget?.semver || '?')"></span>.
                            </p>
                            <template x-if="updateKind === 'template'">
                                <p class="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900">
                                    A new copy will be created with the suffix
                                    <span class="font-mono font-bold" x-text="'(v' + (updateTarget?.semver || '?') + ')'"></span>.
                                    Your current copy is <strong>preserved</strong> so existing
                                    inspections keep working. You can compare side-by-side or
                                    delete the old copy later.
                                </p>
                            </template>
                            <template x-if="updateKind === 'library'">
                                <p class="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900">
                                    The new pack's entries will be <strong>added</strong> alongside
                                    your existing ones. Old entries are <strong>not deleted</strong>.
                                    If you want a clean state, delete the old entries from
                                    <a href="/comments" class="underline">/comments</a> after updating.
                                </p>
                            </template>
                        </div>
                        <footer class="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3">
                            <button x-on:click="closeUpdateConfirm()" class="px-4 py-2 rounded-lg ring-2 ring-slate-200 text-slate-600 text-xs font-bold">Cancel</button>
                            <button x-on:click="confirmUpdate()" class="px-4 py-2 rounded-lg bg-amber-500 text-white text-xs font-bold hover:bg-amber-600">Continue</button>
                        </footer>
                    </div>
                </div>

                {/* Toast — Bug #7 (4-30 review) fix: pre-Alpine render leaks the
                    static "View" anchor text. Default style=display:none keeps toast
                    hidden until Alpine flips x-show on a real toast event. */}
                <div x-show="toast" style="display:none" x-transition class="fixed bottom-6 right-6 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-xl flex items-center gap-3 z-50">
                    <span x-text="toast"></span>
                    <a x-show="toastLink" style="display:none" x-bind:href="toastLink" class="text-violet-400 font-bold text-sm underline">View</a>
                </div>
            </div>

            <script src="/js/auth.js"></script>
            <script src="/js/marketplace.js"></script>
        </MainLayout>
    );
};
