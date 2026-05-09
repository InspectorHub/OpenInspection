/**
 * Sprint 3 S3-3 — Library → Tags page.
 *
 * Tenant-scoped CRUD over the tags library. Five seeded tags appear on
 * first visit (lazy seed via the GET /api/tags handler). Tags rendered
 * as colored pills via the Sprint 1 design tokens (slate / amber / rose
 * / indigo / emerald / sky / fuchsia / lime).
 *
 * Edit + delete are restricted to admin/owner roles by RBAC on the API
 * — this page just disables the buttons for non-privileged users.
 */
import { MainLayout } from '../layouts/main-layout';
import { Modal } from '../components/modal';
import { PageHeader } from '../components/page-header';
import type { BrandingConfig } from '../../types/auth';

interface Props { branding?: BrandingConfig | undefined }

const TAG_COLORS: ReadonlyArray<{ value: string; label: string; tw: string }> = [
    { value: 'slate',    label: 'Slate',    tw: 'bg-slate-100 text-slate-700 ring-slate-200' },
    { value: 'amber',    label: 'Amber',    tw: 'bg-amber-100 text-amber-700 ring-amber-200' },
    { value: 'rose',     label: 'Rose',     tw: 'bg-rose-100 text-rose-700 ring-rose-200' },
    { value: 'indigo',   label: 'Indigo',   tw: 'bg-indigo-100 text-indigo-700 ring-indigo-200' },
    { value: 'emerald',  label: 'Emerald',  tw: 'bg-emerald-100 text-emerald-700 ring-emerald-200' },
    { value: 'sky',      label: 'Sky',      tw: 'bg-sky-100 text-sky-700 ring-sky-200' },
    { value: 'fuchsia',  label: 'Fuchsia',  tw: 'bg-fuchsia-100 text-fuchsia-700 ring-fuchsia-200' },
    { value: 'lime',     label: 'Lime',     tw: 'bg-lime-100 text-lime-700 ring-lime-200' },
];

export const TagsPage = ({ branding }: Props): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout title={`${siteName} | Tags`} branding={branding}>
            <div x-data="tagsLibrary" x-init="init()" class="space-y-6 animate-fade-in">
                <PageHeader
                    eyebrow="LIBRARY · TAGS"
                    eyebrowColor="slate"
                    title="Tags"
                    breadcrumb={[{ label: 'Library', href: '/templates' }, { label: 'Tags' }]}
                    meta={
                        <span x-text="`${tags.length} tag${tags.length === 1 ? '' : 's'} · internal-only labels never shown on customer report`"></span>
                    }
                    actions={
                        <button
                            type="button"
                            data-testid="tag-create-button"
                            x-on:click="openCreate()"
                            class="h-8 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 active:scale-95 transition-all inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                        >
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                            New tag
                        </button>
                    }
                />

                {/* Loading + error */}
                <div x-show="loading" class="text-center py-12 bg-slate-50 rounded-md text-[13px] text-slate-500 font-semibold">Loading tags…</div>
                <div x-show="error" style="display:none" class="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700" x-text="error"></div>

                {/* Empty */}
                <div x-show="!loading && tags.length === 0" style="display:none" class="text-center py-12 bg-slate-50 rounded-md">
                    <p class="text-slate-500 font-semibold">No tags yet.</p>
                    <p class="text-slate-400 text-sm mt-2">Reload to plant the five seed tags, or add your own.</p>
                </div>

                {/* List */}
                <div x-show="!loading && tags.length > 0" style="display:none" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="tag-list">
                    <template x-for="tag in tags" {...{ 'x-bind:key': 'tag.id' }}>
                        <div class="p-4 bg-white border border-slate-200 rounded-md shadow-sm hover:shadow transition" x-bind:data-tag-id="tag.id" x-bind:data-tag-name="tag.name">
                            <div class="flex items-start justify-between gap-3">
                                <div class="flex-1 min-w-0">
                                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-bold ring-1 ring-inset" x-bind:class="colorClass(tag.color)" x-text="tag.name"></span>
                                    <p x-show="tag.isSeed" class="mt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Seed</p>
                                </div>
                                <div class="flex flex-col items-end gap-1 flex-shrink-0">
                                    <button
                                        type="button"
                                        x-show="!tag.isSeed"
                                        x-on:click="openEdit(tag)"
                                        class="text-xs text-slate-700 hover:underline focus:outline-none"
                                        data-testid="tag-edit-button"
                                    >Edit</button>
                                    <button
                                        type="button"
                                        x-on:click="confirmDelete(tag)"
                                        class="text-xs text-rose-600 hover:underline focus:outline-none disabled:text-slate-300 disabled:no-underline"
                                        x-bind:disabled="tag.isSeed"
                                        x-bind:title="tag.isSeed ? 'Seed tags cannot be deleted' : 'Delete this tag'"
                                        data-testid="tag-delete-button"
                                    >Delete</button>
                                </div>
                            </div>
                        </div>
                    </template>
                </div>

                {/* Edit / create modal */}
                <Modal name="showEditModal" titleExpr="editing?.id ? 'Edit tag' : 'New tag'">
                    <form {...{ 'x-on:submit.prevent': 'save()' }} class="space-y-4">
                        <label class="block">
                            <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Name</span>
                            <input
                                type="text"
                                maxLength={40}
                                required
                                x-model="form.name"
                                data-testid="tag-name-input"
                                class="mt-1 w-full h-10 px-3 rounded-md border border-slate-200 text-[14px] font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                            />
                        </label>
                        <label class="block">
                            <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Color</span>
                            <div class="mt-1 flex flex-wrap gap-2">
                                {TAG_COLORS.map(c => (
                                    <button
                                        type="button"
                                        x-on:click={`form.color = '${c.value}'`}
                                        class={`px-3 py-1.5 rounded-full text-[12px] font-bold ring-1 ring-inset transition ${c.tw}`}
                                        x-bind:class={`form.color === '${c.value}' ? 'ring-2 ring-offset-2 ring-indigo-500' : ''`}
                                        data-testid={`tag-color-${c.value}`}
                                    >
                                        {c.label}
                                    </button>
                                ))}
                            </div>
                        </label>

                        <p x-show="formError" style="display:none" class="text-[12px] text-rose-600" x-text="formError"></p>

                        <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                            <button type="button" x-on:click="showEditModal = false" class="h-8 px-4 rounded-md text-slate-600 text-[13px] font-bold hover:bg-slate-50">Cancel</button>
                            <button
                                type="submit"
                                x-bind:disabled="saving"
                                class="h-8 px-4 rounded-md bg-indigo-600 text-white text-[13px] font-bold hover:bg-indigo-700 disabled:bg-slate-300"
                                data-testid="tag-save-button"
                            >
                                <span x-show="!saving">Save</span>
                                <span x-show="saving">Saving…</span>
                            </button>
                        </div>
                    </form>
                </Modal>
            </div>

            <script src="/js/auth.js"></script>
            <script src="/js/tags.js"></script>
        </MainLayout>
    );
};
