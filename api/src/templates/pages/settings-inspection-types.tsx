import { MainLayout } from '../layouts/main-layout';
import { PageHeader } from '../components/page-header';
import { Modal, ModalFooter } from '../components/modal';
import type { BrandingConfig } from '../../types/auth';

interface Props { branding?: BrandingConfig; }

export const SettingsInspectionTypesPage = ({ branding }: Props): JSX.Element => (
    <MainLayout title="Settings | Inspection Types" branding={branding}>
        <div x-data="inspectionTypesAdmin()" class="space-y-8">
            <PageHeader
                eyebrow="Settings · Inspection Types"
                eyebrowColor="slate"
                title="Inspection Types"
            />

            {/* ── Platform types ── */}
            <section class="space-y-4">
                <div>
                    <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-500">Platform</p>
                    <p class="text-sm text-ink-600 mt-0.5">Standard types that ship with the platform.</p>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    <template x-for="pt in platformSubtypes" {...{ 'x-bind:key': 'pt.slug' }}>
                        <div class="p-4 bg-white border border-surface-200 rounded-lg hover:border-blueprint-200 transition">
                            <div class="flex items-start justify-between gap-3">
                                <div class="flex-1 min-w-0">
                                    <p class="font-bold text-ink-900" x-text="pt.name"></p>
                                    <p class="text-xs text-ink-500 mt-1">
                                        <span x-text="pt.templateCount"></span> templates &middot; <span x-text="pt.inspectionCount"></span> inspections
                                    </p>
                                </div>
                                <button
                                    x-on:click="togglePlatform(pt)"
                                    class="text-xs font-semibold px-3 py-1 rounded-md border transition"
                                    {...{ 'x-bind:class': "pt.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-surface-200 bg-surface-100 text-ink-500 hover:bg-surface-200'" }}
                                    x-text="pt.enabled ? 'Enabled' : 'Disabled'"
                                ></button>
                            </div>
                        </div>
                    </template>
                </div>
            </section>

            {/* ── Org types ── */}
            <section class="space-y-4">
                <div class="flex items-end justify-between gap-3">
                    <div>
                        <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-500">Your organization</p>
                        <p class="text-sm text-ink-600 mt-0.5">Custom types based on platform types.</p>
                    </div>
                    <button x-on:click="openAdd()" class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all">+ Add custom subtype</button>
                </div>
                <div x-show="orgSubtypes.length === 0" class="text-center py-10 bg-white border border-surface-200 rounded-lg">
                    <p class="text-ink-600 font-semibold text-sm">No custom subtypes yet.</p>
                </div>
                <div x-show="orgSubtypes.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    <template x-for="ot in orgSubtypes" {...{ 'x-bind:key': 'ot.id' }}>
                        <div class="p-4 bg-white border border-surface-200 rounded-lg hover:border-blueprint-200 transition">
                            <div class="flex items-start justify-between gap-3">
                                <div class="flex-1 min-w-0">
                                    <p class="font-bold text-ink-900" x-text="ot.name"></p>
                                    <p class="text-xs text-ink-500 mt-1">
                                        <span x-text="ot.templateCount"></span> templates &middot; <span x-text="ot.inspectionCount"></span> inspections
                                    </p>
                                </div>
                                <div class="flex flex-col gap-1">
                                    <button x-on:click="openEdit(ot)" class="text-xs text-blueprint-700 hover:underline font-semibold">Edit</button>
                                    <button x-on:click="toggleOrg(ot)" class="text-xs font-semibold" {...{ 'x-bind:class': "ot.enabled ? 'text-ink-500 hover:underline' : 'text-emerald-700 hover:underline'" }} x-text="ot.enabled ? 'Disable' : 'Enable'"></button>
                                </div>
                            </div>
                        </div>
                    </template>
                </div>
            </section>

            {/* ── Add / edit subtype modal ── */}
            <Modal
                name="modalOpen"
                titleExpr="editingId ? 'Edit custom subtype' : 'Add custom subtype'"
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
                        <label class="block text-xs font-bold text-ink-700 mb-1 uppercase tracking-[0.2em]">Name</label>
                        <input type="text" x-model="form.name" required placeholder="e.g., Medical Office" class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none text-sm" />
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-ink-700 mb-1 uppercase tracking-[0.2em]">Based on</label>
                        <select x-model="form.basedOn" class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none text-sm">
                            <option value="">Select a platform type...</option>
                            <template x-for="pt in platformSubtypes" {...{ 'x-bind:key': 'pt.slug' }}>
                                <option {...{ 'x-bind:value': 'pt.slug' }} x-text="pt.name"></option>
                            </template>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-ink-700 mb-1 uppercase tracking-[0.2em]">Description</label>
                        <textarea x-model="form.description" rows={2} placeholder="Optional details..." class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none text-sm"></textarea>
                    </div>
                    <div x-show="duplicateWarning" class="p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800">
                        <span x-text="duplicateWarning"></span>
                    </div>
                </div>
            </Modal>
        </div>

        <script src="/js/auth.js"></script>
        <script src="/js/toast.js"></script>
        <script src="/js/inspection-types-admin.js"></script>
    </MainLayout>
);
