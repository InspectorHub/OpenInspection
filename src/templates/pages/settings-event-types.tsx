import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

interface Props { branding?: BrandingConfig; }

export const SettingsEventTypesPage = ({ branding }: Props): JSX.Element => (
    <MainLayout title="Event Types" branding={branding}>
        <div x-data="settingsEventTypes" x-init="init()" class="space-y-8">
            <header class="flex items-start justify-between flex-wrap gap-4">
                <div>
                    <h1 class="text-3xl font-black text-slate-900 tracking-tight">Event Types</h1>
                    <p class="text-sm text-slate-500 mt-1">Define ancillary inspection events (radon test pickup, sewer scope, follow-up visit, etc.) that can be attached to an inspection.</p>
                </div>
                <div class="flex gap-2">
                    <button x-on:click="seedDefaults()" {...{ 'x-bind:disabled': 'seeding' }} class="px-4 py-2 rounded-xl ring-2 ring-slate-200 text-slate-700 text-xs font-bold uppercase tracking-widest hover:bg-slate-50 disabled:opacity-50">
                        <span x-text="seeding ? 'Seeding...' : 'Seed defaults'"></span>
                    </button>
                    <button x-on:click="openCreate()" class="px-5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold uppercase tracking-widest hover:bg-black">+ Add type</button>
                </div>
            </header>

            <div x-show="types.length === 0 && !loading" class="text-center py-16 bg-slate-50 rounded-2xl">
                <p class="text-slate-500 font-semibold">No event types yet.</p>
                <p class="text-slate-400 text-sm mt-2">Click "Seed defaults" to install a starter set, or "Add type" to define your own.</p>
            </div>

            <div x-show="types.length > 0" class="overflow-hidden rounded-2xl ring-1 ring-slate-200 bg-white">
                <table class="w-full text-sm">
                    <thead class="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
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
                    <tbody class="divide-y divide-slate-100">
                        <template x-for="t in types" {...{ 'x-bind:key': 't.id' }}>
                            <tr class="hover:bg-slate-50">
                                <td class="px-4 py-3">
                                    <div class="flex items-center gap-2">
                                        <span class="w-3 h-3 rounded-full" {...{ 'x-bind:style': "'background:' + (t.color || '#6366f1')" }}></span>
                                        <span class="font-bold text-slate-900" x-text="t.name"></span>
                                        <span x-show="t.active === false" class="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600">Inactive</span>
                                    </div>
                                </td>
                                <td class="px-4 py-3 font-mono text-xs text-slate-600" x-text="t.slug"></td>
                                <td class="px-4 py-3 text-slate-700" x-text="(t.defaultDurationMin || 0) + ' min'"></td>
                                <td class="px-4 py-3 text-slate-700" x-text="'$' + ((t.defaultPriceCents || 0) / 100).toFixed(2)"></td>
                                <td class="px-4 py-3 font-mono text-xs text-slate-500" x-text="t.color"></td>
                                <td class="px-4 py-3 text-slate-700" x-text="t.sortOrder ?? 0"></td>
                                <td class="px-4 py-3 text-right">
                                    <button x-on:click="openEdit(t)" class="text-xs text-indigo-600 hover:underline mr-3">Edit</button>
                                    <button x-on:click="confirmDelete(t)" class="text-xs text-rose-600 hover:underline">Delete</button>
                                </td>
                            </tr>
                        </template>
                    </tbody>
                </table>
            </div>

            {/* Create / edit modal */}
            <div x-show="modalOpen" x-cloak class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" {...{ 'x-on:click': 'if ($event.target === $el) modalOpen = false' }}>
                <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6">
                    <h2 class="text-lg font-bold text-slate-900 mb-4" x-text="editingId ? 'Edit event type' : 'New event type'"></h2>
                    <div class="space-y-3">
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">Name</label>
                            <input type="text" x-model="form.name" required placeholder="e.g., Radon Test — Pickup" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">Slug</label>
                            <input type="text" x-model="form.slug" required placeholder="radon_pickup" pattern="[a-z0-9_]+" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono" />
                            <p class="text-[10px] text-slate-400 mt-1">Lowercase letters, digits, and underscores only.</p>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-xs font-bold text-slate-600 mb-1">Default duration (min)</label>
                                <input type="number" {...{ 'x-model.number': 'form.defaultDurationMin' }} min="1" placeholder="30" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-600 mb-1">Default price ($)</label>
                                <input type="number" {...{ 'x-model.number': 'form.priceDollars' }} min="0" step="0.01" placeholder="0.00" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-xs font-bold text-slate-600 mb-1">Color</label>
                                <div class="flex items-center gap-2">
                                    <input type="color" x-model="form.color" class="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer" />
                                    <input type="text" x-model="form.color" pattern="#[0-9a-fA-F]{6}" class="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm font-mono" />
                                </div>
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-600 mb-1">Sort order</label>
                                <input type="number" {...{ 'x-model.number': 'form.sortOrder' }} min="0" placeholder="0" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                            </div>
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
        <script src="/js/event-types.js"></script>
    </MainLayout>
);
