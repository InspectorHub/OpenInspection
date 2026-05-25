/**
 * Sprint 2 S2-1 — Rating Systems library page.
 *
 * Replaces the Sprint 1 stub. Lists all rating systems available to the
 * tenant (4 seeded + custom clones), lets owners/admins clone seeds, edit
 * custom ones, and set the tenant default. Edit happens in a modal with
 * an inline level-row editor (abbr / label / color / bucket / hotkey).
 */
import { MainLayout } from '../layouts/main-layout';
import { Modal, ModalFooter } from '../components/modal';
import { PageHeader } from '../components/page-header';
import type { BrandingConfig } from '../../types/auth';

interface Props { branding?: BrandingConfig | undefined }

export const RatingSystemsPage = ({ branding }: Props): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout title={`${siteName} | Rating Systems`} branding={branding}>
            <div x-data="ratingSystems" x-init="init()" class="space-y-6 animate-fade-in">
                <PageHeader
                    eyebrow="LIBRARY · RATING SYSTEMS"
                    eyebrowColor="slate"
                    title="Rating Systems"
                    breadcrumb={[{ label: 'Library', href: '/templates' }, { label: 'Rating Systems' }]}
                    meta={
                        <span x-text="`${systems.length} system${systems.length === 1 ? '' : 's'} available · clone a seed system to start customizing`"></span>
                    }
                />

                {/* Loading state */}
                <div x-show="loading" class="text-center py-12 bg-slate-50 dark:bg-slate-800/50 rounded-md">
                    <p class="text-slate-500 font-semibold">Loading rating systems…</p>
                </div>

                {/* Error banner */}
                <div x-show="error" style="display:none" class="rounded-md border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/30 px-4 py-3 text-[13px] text-rose-700 dark:text-rose-400" x-text="error"></div>

                {/* Empty state — only shown when load completed and the list is genuinely empty */}
                <div x-show="!loading && systems.length === 0" style="display:none" class="text-center py-12 bg-slate-50 dark:bg-slate-800/50 rounded-md">
                    <p class="text-slate-500 font-semibold">No rating systems found.</p>
                    <p class="text-slate-400 text-sm mt-2">Reload the page to seed the four canonical systems.</p>
                </div>

                {/* List */}
                <div x-show="!loading && systems.length > 0" style="display:none" class="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="rating-system-list">
                    <template x-for="sys in systems" {...{ 'x-bind:key': 'sys.id' }}>
                        <div class="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm hover:shadow-md transition" x-bind:data-rating-system-id="sys.id" x-bind:data-rating-system-slug="sys.slug">
                            <div class="flex items-start justify-between gap-3">
                                <div class="flex-1 min-w-0">
                                    <div class="flex items-center gap-2 mb-1 flex-wrap">
                                        <p class="font-bold text-slate-900 dark:text-slate-100" x-text="sys.name"></p>
                                        <span x-show="sys.isDefault" class="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 ring-1 ring-indigo-200 dark:ring-indigo-700">Default</span>
                                        <span x-show="sys.isSeed" class="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 ring-1 ring-slate-200 dark:ring-slate-600">Seed</span>
                                    </div>
                                    <p class="text-xs text-slate-500" x-text="sys.description || '(no description)'"></p>
                                    <div class="flex flex-wrap gap-1.5 mt-3">
                                        <template x-for="lvl in sys.levels" {...{ 'x-bind:key': 'lvl.id' }}>
                                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold tabular-nums" x-bind:style="`background-color:${lvl.color}1a; color:${lvl.color}; border: 1px solid ${lvl.color}33`">
                                                <span x-text="lvl.abbr"></span>
                                                <span class="text-slate-500 font-medium" x-text="lvl.label"></span>
                                            </span>
                                        </template>
                                    </div>
                                </div>
                                <div class="flex flex-col gap-1 flex-shrink-0">
                                    <button type="button" x-on:click="cloneSystem(sys)" class="text-xs text-indigo-600 hover:underline" x-bind:data-action-clone="sys.slug">Clone</button>
                                    <button type="button" x-show="!sys.isSeed" x-on:click="openEdit(sys)" class="text-xs text-slate-700 hover:underline">Edit</button>
                                    <button type="button" x-show="!sys.isSeed && !sys.isDefault" x-on:click="setDefault(sys)" class="text-xs text-emerald-600 hover:underline">Set default</button>
                                    <button type="button" x-show="!sys.isSeed" x-on:click="confirmDelete(sys)" class="text-xs text-rose-600 hover:underline">Delete</button>
                                </div>
                            </div>
                        </div>
                    </template>
                </div>

                {/* ── Edit modal ─────────────────────────────────────────── */}
                <Modal
                    name="showEditModal"
                    titleExpr="editing?.id ? 'Edit rating system' : 'New rating system'"
                    subtitleExpr="`${editing?.levels?.length || 0} level(s)`"
                    size="2xl"
                    footer={
                        <ModalFooter
                            confirmText="Save"
                            confirmTextExpr="saving ? 'Saving…' : 'Save'"
                            confirmDisabled="saving"
                            onConfirm="saveEdit()"
                            onCancel="closeEdit()"
                        />
                    }
                >
                    <div class="space-y-4" x-show="editing" style="display:none">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <label class="block">
                                <span class="text-[12px] font-bold text-slate-600 uppercase tracking-widest">Name</span>
                                <input type="text" x-model="editing.name" maxlength={60} class="mt-1 w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-[13px]" placeholder="My Rating System" />
                            </label>
                            <label class="block">
                                <span class="text-[12px] font-bold text-slate-600 uppercase tracking-widest">Slug</span>
                                <input type="text" x-model="editing.slug" maxlength={40} class="mt-1 w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-[13px] font-mono" placeholder="my-system" />
                            </label>
                        </div>
                        <label class="block">
                            <span class="text-[12px] font-bold text-slate-600 uppercase tracking-widest">Description</span>
                            <input type="text" x-model="editing.description" maxlength={200} class="mt-1 w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-[13px]" placeholder="Optional — what is this system for?" />
                        </label>
                        <label class="flex items-center gap-2">
                            <input type="checkbox" x-model="editing.isDefault" class="h-4 w-4 rounded border-slate-300 text-indigo-600" />
                            <span class="text-[13px] text-slate-700">Use as tenant default</span>
                        </label>

                        <div class="border-t border-slate-200 pt-4 space-y-2">
                            <div class="flex items-center justify-between">
                                <span class="text-[12px] font-bold text-slate-600 uppercase tracking-widest">Levels</span>
                                <button type="button" x-on:click="addLevel()" class="text-xs text-indigo-600 hover:underline" x-bind:disabled="(editing?.levels?.length || 0) >= 10">+ Add level</button>
                            </div>
                            <template x-for="(lvl, idx) in editing.levels" {...{ 'x-bind:key': 'idx' }}>
                                <div class="grid grid-cols-12 gap-2 items-center">
                                    <input type="text" x-model="lvl.abbr" maxlength={8} placeholder="Sat" class="col-span-2 px-2 py-1.5 rounded-md border border-slate-200 text-[12px] font-bold uppercase" />
                                    <input type="text" x-model="lvl.label" maxlength={40} placeholder="Satisfactory" class="col-span-3 px-2 py-1.5 rounded-md border border-slate-200 text-[12px]" />
                                    <input type="color" x-model="lvl.color" class="col-span-1 h-9 w-full rounded-md border border-slate-200 cursor-pointer" />
                                    <select x-model="lvl.bucket" class="col-span-3 px-2 py-1.5 rounded-md border border-slate-200 text-[12px]">
                                        <option value="satisfactory">Satisfactory</option>
                                        <option value="monitor">Monitor</option>
                                        <option value="defect">Defect</option>
                                        <option value="na">N/A</option>
                                    </select>
                                    <input type="text" x-model="lvl.hotkey" maxlength={1} placeholder="1" class="col-span-1 px-2 py-1.5 rounded-md border border-slate-200 text-[12px] font-mono text-center" />
                                    <button type="button" x-on:click="removeLevel(idx)" x-bind:disabled="editing.levels.length <= 2" class="col-span-2 text-[11px] text-rose-600 hover:underline disabled:text-slate-300 disabled:no-underline">Remove</button>
                                </div>
                            </template>
                            <p x-show="editLevelError" style="display:none" class="text-[12px] text-rose-600" x-text="editLevelError"></p>
                        </div>
                    </div>
                </Modal>

                {/* Delete confirmation */}
                <Modal
                    name="showDeleteModal"
                    title="Delete rating system?"
                    subtitleExpr="deleteTarget?.name || ''"
                    size="sm"
                    footer={
                        <ModalFooter
                            cancelText="Cancel"
                            confirmText="Delete"
                            danger={true}
                            onConfirm="performDelete()"
                            onCancel="showDeleteModal = false"
                        />
                    }
                >
                    <p class="text-[13px] text-slate-600 leading-relaxed">
                        This action cannot be undone. The rating system will only be removed if no template still binds it.
                    </p>
                </Modal>
            </div>
            {/* auth.js MUST load before rating-systems.js — the latter calls
                window.authFetch from auth.js. Order matches dashboard/templates. */}
            <script src="/js/auth.js"></script>
            <script src="/js/rating-systems.js"></script>
        </MainLayout>
    );
};
