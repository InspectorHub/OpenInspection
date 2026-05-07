import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

interface Props { branding?: BrandingConfig; }

export const CommentsPage = ({ branding }: Props): JSX.Element => (
    <MainLayout title="Comments Library" branding={branding}>
        <div x-data="commentsAdmin" x-init="init()" class="space-y-4">
            <header class="flex items-start justify-between flex-wrap gap-4">
                <div>
                    <h1 class="text-3xl font-bold tracking-tight text-slate-900">Comments Library</h1>
                    <p class="text-sm text-slate-500 mt-1">Pre-written comment snippets. Inspectors attach these to inspection items during field work.</p>
                </div>
                <button x-on:click="openCreate()" class="px-4 py-2 rounded-md bg-indigo-600 text-white text-xs font-bold uppercase tracking-wide hover:bg-indigo-700">+ Add comment</button>
            </header>

            <div class="flex gap-3 flex-wrap">
                <select x-model="categoryFilter" x-on:change="reload()" class="px-3 py-2 rounded-lg border border-slate-200 text-sm">
                    <option value="">All categories</option>
                    <template x-for="cat in distinctCategories" {...{ 'x-bind:key': 'cat' }}>
                        <option x-bind:value="cat" x-text="cat"></option>
                    </template>
                </select>
            </div>

            <div x-show="items.length === 0 && !loading" class="text-center py-12 bg-slate-50 rounded-2xl">
                <p class="text-slate-500 font-semibold">No comments yet.</p>
                <p class="text-slate-400 text-sm mt-2">Click "+ Add comment" above to create your first comment snippet.</p>
            </div>

            <div x-show="items.length > 0" class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <template x-for="comment in items" {...{ 'x-bind:key': 'comment.id' }}>
                    <div class="p-4 bg-white border border-slate-200 rounded-lg shadow-sm hover:shadow-md transition">
                        <div class="flex items-start justify-between gap-3">
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2 mb-1">
                                    <span class="text-xs text-slate-500" x-text="comment.category || '(no category)'"></span>
                                </div>
                                <p class="text-sm text-slate-700 line-clamp-3" x-text="comment.text"></p>
                            </div>
                            <div class="flex flex-col gap-1 flex-shrink-0">
                                <button x-on:click="openEdit(comment)" class="text-xs text-indigo-600 hover:underline">Edit</button>
                                <button x-on:click="confirmDelete(comment)" class="text-xs text-rose-600 hover:underline">Delete</button>
                            </div>
                        </div>
                    </div>
                </template>
            </div>

            {/* Create / Edit modal */}
            <div x-show="modalOpen" x-cloak class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" {...{ 'x-on:click': 'if ($event.target === $el) modalOpen = false' }}>
                <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6">
                    <h2 class="text-lg font-bold text-slate-900 mb-4" x-text="editingId ? 'Edit comment' : 'New comment'"></h2>
                    <div class="space-y-3">
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">Category</label>
                            <input
                                type="text"
                                list="commentCategoryOptions"
                                x-model="form.category"
                                placeholder="e.g., Roof"
                                autocomplete="off"
                                class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                            />
                            <datalist id="commentCategoryOptions">
                                <template x-for="cat in distinctCategories" {...{ 'x-bind:key': 'cat' }}>
                                    <option x-bind:value="cat"></option>
                                </template>
                            </datalist>
                            <p class="text-[10px] text-slate-400 mt-1">Pick from your existing categories or type a new one.</p>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">Comment text</label>
                            <textarea x-model="form.text" required rows={4} placeholder="e.g., Evidence of previous repair was observed." class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"></textarea>
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
        <script type="module" src="/js/comments-admin.js"></script>
    </MainLayout>
);
