import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

interface Props { branding?: BrandingConfig; }

export const SettingsServicesPage = ({ branding }: Props): JSX.Element => (
    <MainLayout title="Service Catalog" branding={branding}>
        <div x-data="settingsServices" x-init="init()" class="space-y-12">
            <header class="flex items-start justify-between flex-wrap gap-4">
                <div>
                    <h1 class="text-xl font-bold text-slate-900 tracking-tight">Service Catalog</h1>
                    <p class="text-sm text-slate-500 mt-1">Define the services you offer (e.g. Standard Inspection, Pre-Listing) and their prices.</p>
                </div>
                <button x-on:click="openCreateService()" class="px-5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold uppercase tracking-widest hover:bg-black">+ Add service</button>
            </header>

            <div x-show="services.length === 0 && !loading" class="text-center py-10 bg-slate-50 rounded-2xl">
                <p class="text-slate-500 font-semibold">No services yet.</p>
                <p class="text-slate-400 text-sm mt-2">Click "Add service" to define your first service.</p>
            </div>

            <div x-show="services.length > 0" class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <template x-for="svc in services" {...{ 'x-bind:key': 'svc.id' }}>
                    <div class="p-4 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md transition">
                        <div class="flex items-start justify-between gap-3">
                            <div class="flex-1 min-w-0">
                                <p class="font-bold text-slate-900" x-text="svc.name"></p>
                                <p class="text-xs text-slate-500 mt-1 line-clamp-2" x-text="svc.description || '(no description)'"></p>
                                <p class="text-sm font-bold text-emerald-700 mt-2" x-text="'$' + ((svc.price || 0) / 100).toFixed(2)"></p>
                            </div>
                            <div class="flex flex-col gap-1">
                                <button x-on:click="openEditService(svc)" class="text-xs text-indigo-600 hover:underline">Edit</button>
                                <button x-on:click="confirmDeleteService(svc)" class="text-xs text-rose-600 hover:underline">Delete</button>
                            </div>
                        </div>
                    </div>
                </template>
            </div>

            <section class="space-y-4">
                <header class="flex items-start justify-between flex-wrap gap-4">
                    <div>
                        <h2 class="text-xl font-bold text-slate-900">Discount Codes</h2>
                        <p class="text-sm text-slate-500 mt-1">Promo codes inspectors can apply at booking time.</p>
                    </div>
                    <button x-on:click="openCreateDiscount()" class="px-5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold uppercase tracking-widest hover:bg-black">+ Add code</button>
                </header>

                <div x-show="discounts.length === 0" class="text-center py-6 bg-slate-50 rounded-2xl">
                    <p class="text-slate-500 font-semibold text-sm">No discount codes yet.</p>
                </div>

                <div x-show="discounts.length > 0" class="space-y-2">
                    <template x-for="d in discounts" {...{ 'x-bind:key': 'd.id' }}>
                        <div class="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl">
                            <div class="flex items-center gap-4 flex-1 min-w-0">
                                <code class="font-mono text-sm font-bold text-slate-900" x-text="d.code"></code>
                                <span class="text-xs text-slate-500" x-text="d.type === 'percent' ? d.value + '% off' : '$' + (d.value / 100).toFixed(2) + ' off'"></span>
                                <span class="text-xs text-slate-400" x-text="d.active ? 'Active' : 'Disabled'"></span>
                            </div>
                            <div class="flex gap-2">
                                <button x-on:click="openEditDiscount(d)" class="text-xs text-indigo-600 hover:underline">Edit</button>
                                <button x-on:click="confirmDeleteDiscount(d)" class="text-xs text-rose-600 hover:underline">Delete</button>
                            </div>
                        </div>
                    </template>
                </div>
            </section>

            {/* Service create / edit modal */}
            <div x-show="serviceModalOpen" x-cloak class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" {...{ 'x-on:click': 'if ($event.target === $el) serviceModalOpen = false' }}>
                <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6">
                    <h2 class="text-lg font-bold text-slate-900 mb-4" x-text="editingServiceId ? 'Edit service' : 'New service'"></h2>
                    <div class="space-y-3">
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">Name</label>
                            <input type="text" x-model="serviceForm.name" required placeholder="e.g., Standard Home Inspection" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">Description</label>
                            <textarea x-model="serviceForm.description" rows={2} placeholder="Optional details..." class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"></textarea>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">Default price ($)</label>
                            <input type="number" {...{ 'x-model.number': 'serviceForm.priceDollars' }} min="0" step="0.01" placeholder="450.00" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                        </div>
                    </div>
                    <div class="flex gap-3 justify-end mt-6">
                        <button x-on:click="serviceModalOpen = false" class="px-5 py-2 rounded-lg ring-2 ring-slate-300 text-slate-700 text-xs font-bold">Cancel</button>
                        <button x-on:click="saveService()" {...{ 'x-bind:disabled': 'saving' }} class="px-5 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold uppercase tracking-widest hover:bg-black disabled:opacity-50">
                            <span x-text="saving ? 'Saving...' : 'Save'"></span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Discount code create / edit modal */}
            <div x-show="discountModalOpen" x-cloak class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" {...{ 'x-on:click': 'if ($event.target === $el) discountModalOpen = false' }}>
                <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6">
                    <h2 class="text-lg font-bold text-slate-900 mb-4" x-text="editingDiscountId ? 'Edit discount code' : 'New discount code'"></h2>
                    <div class="space-y-3">
                        <div>
                            <label class="block text-xs font-bold text-slate-600 mb-1">Code</label>
                            <input type="text" x-model="discountForm.code" required placeholder="EARLYBIRD" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm uppercase font-mono" />
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-xs font-bold text-slate-600 mb-1">Type</label>
                                <select x-model="discountForm.type" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm">
                                    <option value="percent">Percent off</option>
                                    <option value="fixed">Fixed $ off</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-slate-600 mb-1" x-text="discountForm.type === 'percent' ? 'Value (%)' : 'Value ($)'"></label>
                                <input type="number" {...{ 'x-model.number': 'discountForm.valueInput' }} min="0" placeholder="10" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                            </div>
                        </div>
                        <div>
                            <label class="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer">
                                <input type="checkbox" x-model="discountForm.active" />
                                Active
                            </label>
                        </div>
                    </div>
                    <div class="flex gap-3 justify-end mt-6">
                        <button x-on:click="discountModalOpen = false" class="px-5 py-2 rounded-lg ring-2 ring-slate-300 text-slate-700 text-xs font-bold">Cancel</button>
                        <button x-on:click="saveDiscount()" {...{ 'x-bind:disabled': 'saving' }} class="px-5 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold uppercase tracking-widest hover:bg-black disabled:opacity-50">
                            <span x-text="saving ? 'Saving...' : 'Save'"></span>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <script src="/js/auth.js"></script>
        <script src="/js/toast.js"></script>
        <script type="module" src="/js/settings-services.js"></script>
    </MainLayout>
);
