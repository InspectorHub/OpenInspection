import { MainLayout } from '../layouts/main-layout';
import { Modal } from '../components/modal';
import { BrandingConfig } from '../../types/auth';
import { PageHeader } from '../components/page-header';

export const MarketplacePage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout title={`${siteName} | Marketplace`} branding={branding}>
            <div class="space-y-6 animate-fade-in" x-data="marketplace()">
                <PageHeader
                    eyebrow="LIBRARY · MARKETPLACE"
                    eyebrowColor="slate"
                    title="Marketplace"
                    meta={
                        <span x-text="`${templates?.length || 0} templates · ${libraries?.length || 0} libraries · ${(libraries?.filter(l => l.featured).length || 0) + (templates?.filter(t => t.featured).length || 0)} featured`"></span>
                    }
                />
                {/* R7-25: Spell out the import / update relationship so
                    inspectors aren't unsure whether importing creates a
                    copy they own or links to a remote template. */}
                <div class="inline-flex items-start gap-2 px-4 py-2 rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 max-w-2xl">
                    <svg class="w-4 h-4 mt-0.5 flex-shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    <div>
                        <strong>Import = your own copy.</strong> When the publisher updates the template, you'll see "Update available" and can pull the new version (or keep your customizations).
                    </div>
                </div>

                {/* Filters */}
                <div class="flex flex-col sm:flex-row gap-3">
                    <input type="text" x-model="search" {...{ 'x-on:input.debounce.300ms': 'load()' }}
                        placeholder="Search templates..."
                        class="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500" />
                    <select x-model="category" x-on:change="load()"
                        class="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500">
                        <option value="">All Categories</option>
                        <option value="residential">Residential</option>
                        <option value="commercial">Commercial</option>
                        <option value="trec">TREC</option>
                        <option value="condo">Condo</option>
                        <option value="new_construction">New Construction</option>
                    </select>
                    {/* Polish 5 — client-side sort */}
                    <select x-model="sort" x-on:change="resort()"
                        class="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500">
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
                            <div class="glass-panel rounded-md p-6 flex flex-col gap-4 hover:shadow-lg transition" x-bind:class="l.featured ? 'ring-2 ring-amber-400/60' : ''">
                                <div class="flex items-start justify-between">
                                    <div>
                                        <div class="flex items-center gap-2">
                                            <h3 class="font-bold text-slate-900 dark:text-white text-lg" x-text="l.name"></h3>
                                            <span x-show="l.featured" class="text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded-full">★ Featured</span>
                                        </div>
                                        <div class="flex items-center gap-2 mt-1">
                                            <span class="text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full capitalize" x-text="l.kind"></span>
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
                                        <span class="px-4 py-1.5 text-sm rounded-md font-bold bg-slate-100 dark:bg-slate-700 text-slate-400">Imported</span>
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
                        <div class="glass-panel rounded-md p-6 flex flex-col gap-4 hover:shadow-lg transition" x-bind:class="t.featured ? 'ring-2 ring-amber-400/60' : ''">
                            <div class="flex items-start justify-between">
                                <div>
                                    <div class="flex items-center gap-2">
                                        <h3 class="font-bold text-slate-900 dark:text-white text-lg" x-text="t.name"></h3>
                                        <span x-show="t.featured" class="text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded-full">★ Featured</span>
                                    </div>
                                    <div class="flex items-center gap-2 mt-1">
                                        <span class="text-xs font-bold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/30 px-2 py-0.5 rounded-full capitalize" x-text="t.category.replace('_',' ')"></span>
                                        <span class="text-xs text-slate-400 font-mono" x-text="'v' + t.semver"></span>
                                    </div>
                                </div>
                            </div>
                            <p class="text-sm text-slate-500" x-text="t.changelog || 'Standard inspection template.'"></p>
                            <div class="flex items-center justify-between mt-auto pt-2 border-t border-slate-100 dark:border-slate-700 gap-2">
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
                                        <span class="px-4 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-400 text-xs font-bold">Imported</span>
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
                        <div class="col-span-3 ih-empty-state"><h3 class="ih-empty-state__title">No templates found</h3><p class="ih-empty-state__subline">Try a different search or category.</p></div>
                    </template>
                    <template x-if="loading">
                        <div aria-busy="true" class="col-span-3 space-y-3 py-10"><span class="sr-only">Loading…</span><div class="ih-skeleton ih-skeleton--block" style="height: 8rem;"></div></div>
                    </template>
                </div>

                {/* Pagination */}
                <div class="flex items-center justify-center gap-3" x-show="totalPages > 1">
                    <button x-on:click="prevPage()" x-bind:disabled="page <= 1"
                        class="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:text-slate-300 text-sm font-bold disabled:opacity-40">Prev</button>
                    <span class="text-sm text-slate-600 dark:text-slate-300 font-semibold" x-text="`Page ${page} of ${totalPages}`"></span>
                    <button x-on:click="nextPage()" x-bind:disabled="page >= totalPages"
                        class="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:text-slate-300 text-sm font-bold disabled:opacity-40">Next</button>
                </div>

                {/* Polish 5 — Preview modal. Footer has Close + Import (conditional),
                    so it's inlined rather than using ModalFooter. */}
                <Modal
                    name="previewOpen"
                    titleExpr="previewTemplate?.name || 'Preview'"
                    subtitleExpr="previewTemplate?.changelog || ''"
                    size="3xl"
                    footer={
                        <>
                            <button
                                type="button"
                                x-on:click="previewOpen = false"
                                class="h-10 px-4 rounded-xl border bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-600 transition-all"
                                style="border-color: #e2e8f0"
                            >
                                Close
                            </button>
                            <button
                                type="button"
                                x-show="previewTemplate && !previewTemplate.importedSemver"
                                x-on:click="importTemplate(previewTemplate.id); previewOpen = false"
                                class="h-10 px-4 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition-all"
                            >
                                Import this template
                            </button>
                        </>
                    }
                >
                    <div class="space-y-3">
                        {/* Spec 5B P3 — totals row: items, canned comments, defects */}
                        <p class="text-xs font-bold uppercase tracking-widest text-slate-400">
                            <span x-text="previewSchema?.sections?.length || 0"></span> sections ·
                            <span x-text="previewItemCount"></span> items ·
                            <span x-text="previewCannedTotal"></span> canned comments ·
                            <span class="text-rose-500" x-text="previewDefectTotal + ' defects'"></span>
                        </p>
                        <template x-for="sec in (previewSchema?.sections || [])" {...{ 'x-bind:key': 'sec.id' }}>
                            <details class="bg-slate-50 dark:bg-slate-800 rounded-xl p-3" open>
                                <summary class="cursor-pointer font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center justify-between">
                                    <span x-text="sec.title || sec.name || sec.id"></span>
                                    <span class="text-xs text-slate-400" x-text="(sec.items?.length || 0) + ' items'"></span>
                                </summary>
                                <ul class="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-400 pl-3">
                                    <template x-for="it in (sec.items || [])" {...{ 'x-bind:key': 'it.id' }}>
                                        <li class="flex items-center gap-2 flex-wrap py-1">
                                            <span class="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600"></span>
                                            <span class="font-semibold text-slate-700 dark:text-slate-200" x-text="it.label || it.name || it.id"></span>
                                            <span class="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300" x-text="it.type || 'rich'"></span>
                                            <span x-show="it._info > 0" class="text-[10px] font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded" x-text="'info: ' + it._info"></span>
                                            <span x-show="it._lim > 0" class="text-[10px] font-mono text-sky-700 dark:text-sky-400 bg-sky-50 dark:bg-sky-900/30 px-1.5 py-0.5 rounded" x-text="'lim: ' + it._lim"></span>
                                            <span x-show="it._def > 0" class="text-[10px] font-mono text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/30 px-1.5 py-0.5 rounded" x-text="'def: ' + it._def"></span>
                                        </li>
                                    </template>
                                </ul>
                            </details>
                        </template>
                    </div>
                </Modal>

                {/* Round 37 — Update confirm modal. Explains the "new copy"
                    semantics (Scheme 2) so the inspector knows their existing
                    template/library entries are preserved. Custom amber Continue
                    button — inlined rather than using ModalFooter. */}
                <Modal
                    name="updateConfirmOpen"
                    titleExpr="updateKind === 'library' ? 'Update library?' : 'Update template?'"
                    size="md"
                    footer={
                        <>
                            <button
                                type="button"
                                x-on:click="closeUpdateConfirm()"
                                class="flex-1 h-10 px-4 rounded-xl border bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-600 transition-all"
                                style="border-color: #e2e8f0"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                x-on:click="confirmUpdate()"
                                class="flex-1 h-10 px-4 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition-all"
                            >
                                Continue
                            </button>
                        </>
                    }
                >
                    <div class="space-y-3 text-sm text-slate-700 dark:text-slate-200">
                        <p>
                            <strong x-text="updateTarget?.name || ''"></strong>
                            <span class="text-slate-500 dark:text-slate-400"> will move from </span>
                            <span class="font-mono text-xs text-slate-700 dark:text-slate-300" x-text="'v' + (updateTarget?.importedSemver || '?')"></span>
                            <span class="text-slate-500 dark:text-slate-400"> to </span>
                            <span class="font-mono text-xs font-bold text-amber-700 dark:text-amber-400" x-text="'v' + (updateTarget?.semver || '?')"></span>.
                        </p>
                        <template x-if="updateKind === 'template'">
                            <p class="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                                A new copy will be created with the suffix
                                <span class="font-mono font-bold" x-text="'(v' + (updateTarget?.semver || '?') + ')'"></span>.
                                Your current copy is <strong>preserved</strong> so existing
                                inspections keep working. You can compare side-by-side or
                                delete the old copy later.
                            </p>
                        </template>
                        <template x-if="updateKind === 'library'">
                            <p class="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                                The new pack's entries will be <strong>added</strong> alongside
                                your existing ones. Old entries are <strong>not deleted</strong>.
                                If you want a clean state, delete the old entries from
                                <a href="/comments" class="underline">/comments</a> after updating.
                            </p>
                        </template>
                    </div>
                </Modal>

                {/* Toast — Bug #7 (4-30 review) fix: pre-Alpine render leaks the
                    static "View" anchor text. Default style=display:none keeps toast
                    hidden until Alpine flips x-show on a real toast event. */}
                <div x-show="toast" style="display:none" x-transition class="fixed bottom-6 right-6 bg-slate-900 text-white px-5 py-3 rounded-md shadow-xl flex items-center gap-3 z-50">
                    <span x-text="toast"></span>
                    <a x-show="toastLink" style="display:none" x-bind:href="toastLink" class="text-violet-400 font-bold text-sm underline">View</a>
                </div>
            </div>

            <script src="/js/auth.js"></script>
            <script src="/js/marketplace.js"></script>
        </MainLayout>
    );
};
