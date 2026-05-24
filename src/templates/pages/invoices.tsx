import { MainLayout } from '../layouts/main-layout';
import { Modal, ModalFooter } from '../components/modal';
import { BrandingConfig } from '../../types/auth';
import { PageHeader } from '../components/page-header';

export const InvoicesPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout title={`${siteName} | Invoices`} branding={branding}>
            <div class="space-y-[18px] animate-fade-in">
                <div x-data="invoicesMeta">
                    <PageHeader
                        eyebrow="INVOICES"
                        eyebrowColor="emerald"
                        title="Invoices"
                        meta={<span x-text="metaText"></span>}
                        actions={
                            <button
                                onclick="showCreateModal()"
                                class="h-8 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 active:scale-95 transition-all inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                            >
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                                New Invoice
                            </button>
                        }
                    />
                </div>

                {/* Stats */}
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div class="glass-panel rounded-lg p-4">
                        <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">Total</p>
                        <p id="statTotal" class="text-xl font-bold text-slate-900">—</p>
                    </div>
                    <div class="glass-panel rounded-lg p-4">
                        <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">Unpaid</p>
                        <p id="statUnpaid" class="text-xl font-bold text-amber-600">—</p>
                    </div>
                    <div class="glass-panel rounded-lg p-4">
                        <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">Paid</p>
                        <p id="statPaid" class="text-xl font-bold text-emerald-600">—</p>
                    </div>
                    <div class="glass-panel rounded-lg p-4">
                        <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">Revenue</p>
                        <p id="statRevenue" class="text-xl font-bold text-indigo-600">—</p>
                    </div>
                </div>

                <div class="glass-panel rounded-xl overflow-hidden shadow-md">
                    <table class="w-full text-left">
                        <thead class="bg-slate-50/40">
                            <tr>
                                <th class="py-3 px-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Client</th>
                                <th class="py-3 px-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Amount</th>
                                <th class="py-3 px-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Due Date</th>
                                <th class="py-3 px-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Status</th>
                                <th class="relative py-3 pl-3 pr-4 text-right"><span class="sr-only">Actions</span></th>
                            </tr>
                        </thead>
                        <tbody id="invoicesBody">
                            <tr aria-busy="true"><td colspan={5} class="px-4 py-3"><span class="sr-only">Loading…</span><div class="ih-skeleton ih-skeleton--text" style="height: 1rem; width: 80%; margin: 0 auto;"></div></td></tr>
                            <tr aria-busy="true"><td colspan={5} class="px-4 py-3"><div class="ih-skeleton ih-skeleton--text" style="height: 1rem; width: 65%; margin: 0 auto;"></div></td></tr>
                            <tr aria-busy="true"><td colspan={5} class="px-4 py-3"><div class="ih-skeleton ih-skeleton--text" style="height: 1rem; width: 90%; margin: 0 auto;"></div></td></tr>
                        </tbody>
                    </table>
                </div>

                {/* Create Modal */}
                <Modal
                    id="invoiceModal"
                    title="New Invoice"
                    size="lg"
                    footer={
                        <ModalFooter
                            onCancelJs="closeInvoiceModal()"
                            onConfirmJs="submitInvoice()"
                            confirmText="Create"
                        />
                    }
                >
                    <div class="space-y-5">
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Client Name *</label>
                                <input type="text" id="invClientName" placeholder="John Smith" class="w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-sm" />
                            </div>
                            <div>
                                <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Client Email</label>
                                <input type="email" id="invClientEmail" placeholder="john@example.com" class="w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-sm" />
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Amount ($)</label>
                                <input type="number" id="invAmount" min="0" step="0.01" placeholder="350.00" class="w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-sm" />
                            </div>
                            <div>
                                <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Due Date</label>
                                {/* Iter-2 bug #6 — `lang="en"` prevents OS-locale leak
                                    (e.g. zh-CN browsers showing「年/月/日」placeholder). */}
                                <input type="date" lang="en" placeholder="YYYY-MM-DD" id="invDueDate" class="w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-sm" />
                            </div>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Notes</label>
                            <textarea id="invNotes" rows={3} placeholder="Optional notes..." class="w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-sm resize-none"></textarea>
                        </div>
                    </div>
                </Modal>

                <script src="/js/modal-dialog.js"></script>
                <script src="/js/auth.js"></script>
                <script src="/js/invoices.js"></script>
            </div>
        </MainLayout>
    );
};
