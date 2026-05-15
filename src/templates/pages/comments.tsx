import { MainLayout } from '../layouts/main-layout';
import { Modal, ModalFooter } from '../components/modal';
import { BrandingConfig } from '../../types/auth';
import { PageHeader } from '../components/page-header';

interface Props { branding?: BrandingConfig; }

export const CommentsPage = ({ branding }: Props): JSX.Element => (
    <MainLayout title="Comments Library" branding={branding}>
        <div x-data="commentsAdmin" x-init="init()" class="space-y-6">
            <PageHeader
                eyebrow="LIBRARY · COMMENTS"
                eyebrowColor="slate"
                title="Comments Library"
                meta={
                    <span x-text="`${items?.length || 0} in library${(distinctCategories?.length || 0) ? ' · ' + (distinctCategories.length) + ' categor' + (distinctCategories.length === 1 ? 'y' : 'ies') : ''}`"></span>
                }
                actions={
                    <button
                        x-on:click="openCreate()"
                        class="h-8 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 active:scale-95 transition-all inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                        Add comment
                    </button>
                }
            />

            {/*
              Spec 2026-05-07 — rating-bucket tabs mirror the inspection-edit
              Library drawer pills (rounded-full, indigo active state). The
              `categoryFilter` dropdown stays as a secondary filter so a user
              can combine "Defect" tab + "Plumbing" category.
            */}
            <div class="flex flex-wrap items-center gap-2">
                <template x-for="b in bucketTabs" {...{ 'x-bind:key': 'b.value' }}>
                    <button
                        x-on:click="setBucket(b.value)"
                        x-bind:class="bucket === b.value ? 'bg-indigo-600 text-white shadow' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'"
                        class="px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide transition"
                        x-text="b.label"
                    ></button>
                </template>
            </div>

            <div class="flex gap-3 flex-wrap">
                <select x-model="categoryFilter" x-on:change="reload()" class="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-100 text-sm">
                    <option value="">All categories</option>
                    <template x-for="cat in distinctCategories" {...{ 'x-bind:key': 'cat' }}>
                        <option x-bind:value="cat" x-text="cat"></option>
                    </template>
                </select>
                <select x-model="sectionFilter" x-on:change="reload()" class="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-100 text-sm">
                    <option value="">All sections</option>
                    <template x-for="s in distinctSections" {...{ 'x-bind:key': 's' }}>
                        <option x-bind:value="s" x-text="s"></option>
                    </template>
                </select>
            </div>

            <div x-show="items.length === 0 && !loading" class="text-center py-12 bg-slate-50 dark:bg-slate-700/30 rounded-md">
                <p class="text-slate-500 dark:text-slate-400 font-semibold">No comments yet.</p>
                <p class="text-slate-400 dark:text-slate-500 text-sm mt-2">Click "+ Add comment" above to create your first comment snippet.</p>
            </div>

            <div x-show="items.length > 0" class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <template x-for="comment in items" {...{ 'x-bind:key': 'comment.id' }}>
                    <div class="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm hover:shadow-md transition">
                        <div class="flex items-start justify-between gap-3">
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2 mb-1 flex-wrap">
                                    {/*
                                      Pill uses the shared .ih-pill / ih-pill--sat / monitor / defect / gen
                                      classes so /comments matches the
                                      inspection-edit drawer + report PDF pill styling.
                                    */}
                                    <span
                                        class="ih-pill"
                                        x-bind:class="comment.ratingBucket === 'satisfactory' ? 'ih-pill--sat' : comment.ratingBucket === 'monitor' ? 'ih-pill--monitor' : comment.ratingBucket === 'defect' ? 'ih-pill--defect' : 'ih-pill--gen'"
                                        x-text="comment.ratingBucket ? comment.ratingBucket : 'general'"
                                    ></span>
                                    <span x-show="comment.section" class="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400" x-text="comment.section"></span>
                                    <span x-show="comment.category" class="text-[10px] text-slate-400 dark:text-slate-500" x-text="'· ' + comment.category"></span>
                                </div>
                                <p class="text-sm text-slate-700 dark:text-slate-300 line-clamp-3" x-text="comment.text"></p>
                            </div>
                            <div class="flex flex-col gap-1 flex-shrink-0">
                                <button x-on:click="openEdit(comment)" class="text-xs text-indigo-600 hover:underline">Edit</button>
                                <button x-on:click="confirmDelete(comment)" class="text-xs text-rose-600 hover:underline">Delete</button>
                            </div>
                        </div>
                    </div>
                </template>
            </div>

            {/* Create / Edit modal — wrapped in shared <Modal> component (R44).
                When adding new fields, KEEP them inside this body slot — do
                NOT recreate the modal markup. */}
            <Modal
                name="modalOpen"
                titleExpr="editingId ? 'Edit comment' : 'New comment'"
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
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">Rating bucket</label>
                            <select x-model="form.ratingBucket" class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-sm bg-white dark:bg-slate-700 dark:text-slate-100">
                                <option value="">Unspecified</option>
                                <option value="satisfactory">Satisfactory</option>
                                <option value="monitor">Monitor</option>
                                <option value="defect">Defect</option>
                            </select>
                            <p class="text-[10px] text-slate-400 mt-1">Determines which tab it appears under in the Library drawer.</p>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">Section</label>
                            <input
                                type="text"
                                list="commentSectionOptions"
                                x-model="form.section"
                                placeholder="e.g., Roof"
                                autocomplete="off"
                                class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm"
                            />
                            <datalist id="commentSectionOptions">
                                <template x-for="s in distinctSections" {...{ 'x-bind:key': 's' }}>
                                    <option x-bind:value="s"></option>
                                </template>
                            </datalist>
                            <p class="text-[10px] text-slate-400 mt-1">Pick from your existing sections or type a new one.</p>
                        </div>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">Category</label>
                        <input
                            type="text"
                            list="commentCategoryOptions"
                            x-model="form.category"
                            placeholder="e.g., Roof"
                            autocomplete="off"
                            class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm"
                        />
                        <datalist id="commentCategoryOptions">
                            <template x-for="cat in distinctCategories" {...{ 'x-bind:key': 'cat' }}>
                                <option x-bind:value="cat"></option>
                            </template>
                        </datalist>
                        <p class="text-[10px] text-slate-400 mt-1">Optional free-text label, kept for backward compat.</p>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1">Comment text</label>
                        <textarea x-model="form.text" required rows={4} placeholder="e.g., Evidence of previous repair was observed." class="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm"></textarea>
                    </div>
                </div>
            </Modal>
        </div>

        <script src="/js/auth.js"></script>
        <script src="/js/toast.js"></script>
        <script type="module" src="/js/comments-admin.js"></script>
    </MainLayout>
);
