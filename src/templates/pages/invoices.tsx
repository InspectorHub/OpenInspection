import { MainLayout } from '../layouts/main-layout';
import { Modal, ModalFooter } from '../components/modal';
import { BrandingConfig } from '../../types/auth';

export const InvoicesPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout title={`${siteName} | Invoices`} branding={branding}>
            <div class="space-y-6 animate-fade-in">
                <div class="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <span class="inline-flex items-center rounded-lg bg-violet-600/10 px-3 py-1 text-[10px] font-bold text-violet-600 uppercase tracking-[0.2em] ring-1 ring-inset ring-violet-600/20 mb-4">Invoices</span>
                        <h1 class="text-3xl font-bold tracking-tight text-slate-900">Invoices</h1>
                        <p class="text-lg text-slate-500 font-semibold mt-2">Track and manage client invoices.</p>
                    </div>
                    <button onclick="showCreateModal()" class="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md font-bold text-sm hover:bg-indigo-700 active:scale-[.98] transition-all">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                        New Invoice
                    </button>
                </div>

                {/* Stats */}
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div class="glass-panel rounded-lg p-6">
                        <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">Total</p>
                        <p id="statTotal" class="text-xl font-bold text-slate-900">—</p>
                    </div>
                    <div class="glass-panel rounded-lg p-6">
                        <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">Unpaid</p>
                        <p id="statUnpaid" class="text-xl font-bold text-amber-600">—</p>
                    </div>
                    <div class="glass-panel rounded-lg p-6">
                        <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">Paid</p>
                        <p id="statPaid" class="text-xl font-bold text-emerald-600">—</p>
                    </div>
                    <div class="glass-panel rounded-lg p-6">
                        <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">Revenue</p>
                        <p id="statRevenue" class="text-xl font-bold text-indigo-600">—</p>
                    </div>
                </div>

                <div class="glass-panel rounded-xl overflow-hidden shadow-md">
                    <table class="w-full text-left">
                        <thead class="bg-slate-50/40">
                            <tr>
                                <th class="py-6 px-10 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Client</th>
                                <th class="py-6 px-8 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Amount</th>
                                <th class="py-6 px-8 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Due Date</th>
                                <th class="py-6 px-8 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Status</th>
                                <th class="relative py-6 pl-3 pr-10 text-right"><span class="sr-only">Actions</span></th>
                            </tr>
                        </thead>
                        <tbody id="invoicesBody">
                            <tr><td colspan={5} class="px-10 py-8 text-center text-slate-400 font-semibold">Loading...</td></tr>
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
                                <input type="date" id="invDueDate" class="w-full px-3 py-2 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-sm" />
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
