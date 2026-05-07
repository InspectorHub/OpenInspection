import { SettingsLayout } from '../components/settings-layout';
import { BrandingConfig } from '../../types/auth';

interface Props { branding?: BrandingConfig; }

export const SettingsServicesPage = ({ branding }: Props): JSX.Element => (
    <SettingsLayout
        branding={branding}
        title="Settings | Services & Pricing"
        group="catalog"
        subPage="services"
        pageTitle="Services & Pricing"
        pageSubtitle="Define the services you offer (e.g. Standard Inspection, Pre-Listing) and their prices, plus any discount codes."
    >
        <div x-data="settingsServices" x-init="init()" class="space-y-8">
            {/* ── Services ── */}
            <section class="space-y-4">
                <header class="flex items-center justify-between gap-3">
                    <h2 class="text-lg font-bold text-ink-900 tracking-tight">Services</h2>
                    <button x-on:click="openCreateService()" class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all">+ Add service</button>
                </header>

                <div x-show="services.length === 0 && !loading" class="text-center py-10 bg-white border border-surface-200 rounded-lg">
                    <p class="text-ink-700 font-semibold">No services yet.</p>
                    <p class="text-ink-500 text-sm mt-2">Click "Add service" to define your first service.</p>
                </div>

                <div x-show="services.length > 0" class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <template x-for="svc in services" {...{ 'x-bind:key': 'svc.id' }}>
                        <div class="p-4 bg-white border border-surface-200 rounded-lg hover:border-blueprint-200 transition">
                            <div class="flex items-start justify-between gap-3">
                                <div class="flex-1 min-w-0">
                                    <p class="font-bold text-ink-900" x-text="svc.name"></p>
                                    <p class="text-xs text-ink-600 mt-1 line-clamp-2" x-text="svc.description || '(no description)'"></p>
                                    <p class="text-sm font-bold text-emerald-700 mt-2" x-text="'$' + ((svc.price || 0) / 100).toFixed(2)"></p>
                                </div>
                                <div class="flex flex-col gap-1">
                                    <button x-on:click="openEditService(svc)" class="text-xs text-blueprint-700 hover:underline font-semibold">Edit</button>
                                    <button x-on:click="confirmDeleteService(svc)" class="text-xs text-rose-600 hover:underline font-semibold">Delete</button>
                                </div>
                            </div>
                        </div>
                    </template>
                </div>
            </section>

            {/* ── Discounts ── */}
            <section class="space-y-4">
                <header class="flex items-center justify-between gap-3">
                    <div>
                        <h2 class="text-lg font-bold text-ink-900 tracking-tight">Discount Codes</h2>
                        <p class="text-sm text-ink-600 mt-0.5">Promo codes inspectors can apply at booking time.</p>
                    </div>
                    <button x-on:click="openCreateDiscount()" class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all">+ Add code</button>
                </header>

                <div x-show="discounts.length === 0" class="text-center py-6 bg-white border border-surface-200 rounded-lg">
                    <p class="text-ink-600 font-semibold text-sm">No discount codes yet.</p>
                </div>

                <div x-show="discounts.length > 0" class="space-y-2">
                    <template x-for="d in discounts" {...{ 'x-bind:key': 'd.id' }}>
                        <div class="flex items-center justify-between p-3 bg-white border border-surface-200 rounded-md">
                            <div class="flex items-center gap-4 flex-1 min-w-0">
                                <code class="font-mono text-sm font-bold text-ink-900" x-text="d.code"></code>
                                <span class="text-xs text-ink-600" x-text="d.type === 'percent' ? d.value + '% off' : '$' + (d.value / 100).toFixed(2) + ' off'"></span>
                                <span class="text-xs text-ink-500" x-text="d.active ? 'Active' : 'Disabled'"></span>
                            </div>
                            <div class="flex gap-3">
                                <button x-on:click="openEditDiscount(d)" class="text-xs text-blueprint-700 hover:underline font-semibold">Edit</button>
                                <button x-on:click="confirmDeleteDiscount(d)" class="text-xs text-rose-600 hover:underline font-semibold">Delete</button>
                            </div>
                        </div>
                    </template>
                </div>
            </section>

            {/* Service create / edit modal */}
            <div x-show="serviceModalOpen" x-cloak class="fixed inset-0 z-50 bg-ink-900/50 flex items-center justify-center p-4" {...{ 'x-on:click': 'if ($event.target === $el) serviceModalOpen = false' }}>
                <div class="bg-white rounded-lg border border-surface-200 max-w-lg w-full p-6">
                    <h2 class="text-lg font-bold text-ink-900 mb-4" x-text="editingServiceId ? 'Edit service' : 'New service'"></h2>
                    <div class="space-y-3">
                        <div>
                            <label class="block text-xs font-bold text-ink-700 mb-1 uppercase tracking-[0.2em]">Name</label>
                            <input type="text" x-model="serviceForm.name" required placeholder="e.g., Standard Home Inspection" class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none text-sm" />
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-ink-700 mb-1 uppercase tracking-[0.2em]">Description</label>
                            <textarea x-model="serviceForm.description" rows={2} placeholder="Optional details..." class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none text-sm"></textarea>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-ink-700 mb-1 uppercase tracking-[0.2em]">Default price ($)</label>
                            <input type="number" {...{ 'x-model.number': 'serviceForm.priceDollars' }} min="0" step="0.01" placeholder="450.00" class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none text-sm" />
                        </div>
                    </div>
                    <div class="flex gap-3 justify-end mt-6">
                        <button x-on:click="serviceModalOpen = false" class="px-4 py-2 rounded-md border border-surface-200 bg-white text-ink-700 text-sm font-semibold hover:bg-surface-100 transition-all">Cancel</button>
                        <button x-on:click="saveService()" {...{ 'x-bind:disabled': 'saving' }} class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all disabled:opacity-50">
                            <span x-text="saving ? 'Saving...' : 'Save'"></span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Discount code create / edit modal */}
            <div x-show="discountModalOpen" x-cloak class="fixed inset-0 z-50 bg-ink-900/50 flex items-center justify-center p-4" {...{ 'x-on:click': 'if ($event.target === $el) discountModalOpen = false' }}>
                <div class="bg-white rounded-lg border border-surface-200 max-w-lg w-full p-6">
                    <h2 class="text-lg font-bold text-ink-900 mb-4" x-text="editingDiscountId ? 'Edit discount code' : 'New discount code'"></h2>
                    <div class="space-y-3">
                        <div>
                            <label class="block text-xs font-bold text-ink-700 mb-1 uppercase tracking-[0.2em]">Code</label>
                            <input type="text" x-model="discountForm.code" required placeholder="EARLYBIRD" class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none text-sm uppercase font-mono" />
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-xs font-bold text-ink-700 mb-1 uppercase tracking-[0.2em]">Type</label>
                                <select x-model="discountForm.type" class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none text-sm">
                                    <option value="percent">Percent off</option>
                                    <option value="fixed">Fixed $ off</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-ink-700 mb-1 uppercase tracking-[0.2em]" x-text="discountForm.type === 'percent' ? 'Value (%)' : 'Value ($)'"></label>
                                <input type="number" {...{ 'x-model.number': 'discountForm.valueInput' }} min="0" placeholder="10" class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none text-sm" />
                            </div>
                        </div>
                        <div>
                            <label class="flex items-center gap-2 text-xs font-bold text-ink-700 cursor-pointer">
                                <input type="checkbox" x-model="discountForm.active" />
                                Active
                            </label>
                        </div>
                    </div>
                    <div class="flex gap-3 justify-end mt-6">
                        <button x-on:click="discountModalOpen = false" class="px-4 py-2 rounded-md border border-surface-200 bg-white text-ink-700 text-sm font-semibold hover:bg-surface-100 transition-all">Cancel</button>
                        <button x-on:click="saveDiscount()" {...{ 'x-bind:disabled': 'saving' }} class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all disabled:opacity-50">
                            <span x-text="saving ? 'Saving...' : 'Save'"></span>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <script src="/js/auth.js"></script>
        <script src="/js/toast.js"></script>
        <script type="module" src="/js/settings-services.js"></script>
    </SettingsLayout>
);
