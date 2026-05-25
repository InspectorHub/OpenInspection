import { SettingsLayout } from '../components/settings-layout';
import { Modal, ModalFooter } from '../components/modal';
import { BrandingConfig } from '../../types/auth';

interface Props { branding?: BrandingConfig; }

export const SettingsEventTypesPage = ({ branding }: Props): JSX.Element => (
    <SettingsLayout
        branding={branding}
        title="Settings | Event types"
        group="catalog"
        subPage="event-types"
        pageTitle="Event types"
        pageSubtitle="Define ancillary inspection events (radon test pickup, sewer scope, follow-up visit, etc.) that can be attached to an inspection."
    >
        <div x-data="settingsEventTypes" x-init="init()" class="space-y-5">
            <div class="flex justify-end gap-2">
                <button x-on:click="seedDefaults()" {...{ 'x-bind:disabled': 'seeding' }} class="px-4 py-2 rounded-md border border-surface-200 bg-white text-ink-700 text-sm font-semibold hover:bg-surface-100 transition-all disabled:opacity-50">
                    <span x-text="seeding ? 'Seeding...' : 'Seed defaults'"></span>
                </button>
                <button x-on:click="openCreate()" class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all">+ Add type</button>
            </div>

            <div x-show="types.length === 0 && !loading" class="text-center py-10 bg-white border border-surface-200 rounded-lg">
                <p class="text-ink-700 font-semibold">No event types yet.</p>
                <p class="text-ink-500 text-sm mt-2">Click "Seed defaults" to install a starter set, or "Add type" to define your own.</p>
            </div>

            <div x-show="types.length > 0" class="overflow-hidden rounded-lg border border-surface-200 bg-white">
                <table class="w-full text-sm">
                    <thead class="bg-surface-100 text-[10px] uppercase tracking-widest text-ink-500">
                        <tr>
                            <th class="px-4 py-3 text-left font-bold">Name</th>
                            <th class="px-4 py-3 text-left font-bold">Slug</th>
                            <th class="px-4 py-3 text-left font-bold">Default duration</th>
                            <th class="px-4 py-3 text-left font-bold">Default price</th>
                            <th class="px-4 py-3 text-left font-bold">Color</th>
                            <th class="px-4 py-3 text-left font-bold">Sort</th>
                            <th class="px-4 py-3 text-right font-bold">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-surface-200">
                        <template x-for="t in types" {...{ 'x-bind:key': 't.id' }}>
                            <tr class="hover:bg-surface-50">
                                <td class="px-4 py-3">
                                    <div class="flex items-center gap-2">
                                        <span class="w-3 h-3 rounded-full" {...{ 'x-bind:style': "'background:' + (t.color || '#4a72ff')" }}></span>
                                        <span class="font-bold text-ink-900" x-text="t.name"></span>
                                        <span x-show="t.active === false" class="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-surface-200 text-ink-600">Inactive</span>
                                    </div>
                                </td>
                                <td class="px-4 py-3 font-mono text-xs text-ink-600" x-text="t.slug"></td>
                                <td class="px-4 py-3 text-ink-700" x-text="(t.defaultDurationMin || 0) + ' min'"></td>
                                <td class="px-4 py-3 text-ink-700" x-text="'$' + ((t.defaultPriceCents || 0) / 100).toFixed(2)"></td>
                                <td class="px-4 py-3 font-mono text-xs text-ink-500" x-text="t.color"></td>
                                <td class="px-4 py-3 text-ink-700" x-text="t.sortOrder ?? 0"></td>
                                <td class="px-4 py-3 text-right">
                                    <button x-on:click="openEdit(t)" class="text-xs text-blueprint-700 hover:underline mr-3 font-semibold">Edit</button>
                                    <button x-on:click="confirmDelete(t)" class="text-xs text-rose-600 hover:underline font-semibold">Delete</button>
                                </td>
                            </tr>
                        </template>
                    </tbody>
                </table>
            </div>

            {/* Create / edit modal */}
            <Modal
                name="modalOpen"
                titleExpr="editingId ? 'Edit event type' : 'New event type'"
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
                            <input type="text" x-model="form.name" required placeholder="e.g., Radon Test — Pickup" class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none text-sm" />
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-ink-700 mb-1 uppercase tracking-[0.2em]">Slug</label>
                            <input type="text" x-model="form.slug" required placeholder="radon_pickup" pattern="[a-z0-9_]+" class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none text-sm font-mono" />
                            <p class="text-[10px] text-ink-500 mt-1">Lowercase letters, digits, and underscores only.</p>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-xs font-bold text-ink-700 mb-1 uppercase tracking-[0.2em]">Default duration (min)</label>
                                <input type="number" {...{ 'x-model.number': 'form.defaultDurationMin' }} min="1" placeholder="30" class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none text-sm" />
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-ink-700 mb-1 uppercase tracking-[0.2em]">Default price ($)</label>
                                <input type="number" {...{ 'x-model.number': 'form.priceDollars' }} min="0" step="0.01" placeholder="0.00" class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none text-sm" />
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-xs font-bold text-ink-700 mb-1 uppercase tracking-[0.2em]">Color</label>
                                <div class="flex items-center gap-2">
                                    <input type="color" x-model="form.color" class="w-10 h-10 rounded-md border border-surface-200 cursor-pointer" />
                                    <input type="text" x-model="form.color" pattern="#[0-9a-fA-F]{6}" class="flex-1 px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none text-sm font-mono" />
                                </div>
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-ink-700 mb-1 uppercase tracking-[0.2em]">Sort order</label>
                                <input type="number" {...{ 'x-model.number': 'form.sortOrder' }} min="0" placeholder="0" class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none text-sm" />
                            </div>
                        </div>
                </div>
            </Modal>
        </div>

        <script src="/js/auth.js"></script>
        <script src="/js/toast.js"></script>
        <script src="/js/event-types.js"></script>
    </SettingsLayout>
);
