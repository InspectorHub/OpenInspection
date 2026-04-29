import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

export const InvoicesPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout title={`${siteName} | Invoices`} branding={branding}>
            <div class="space-y-10 animate-fade-in">
                <div class="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <span class="inline-flex items-center rounded-lg bg-violet-600/10 px-3 py-1 text-[10px] font-black text-violet-600 uppercase tracking-[0.2em] ring-1 ring-inset ring-violet-600/20 mb-4">Invoices</span>
                        <h1 class="text-5xl font-black tracking-tight text-slate-900">Invoices</h1>
                        <p class="text-lg text-slate-500 font-semibold mt-2">Track and manage client invoices.</p>
                    </div>
                    <button onclick="showCreateModal()" class="premium-button flex items-center gap-2 px-8 py-4 rounded-2xl bg-indigo-600 text-white font-bold shadow-xl hover:bg-slate-900 transition">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                        New Invoice
                    </button>
                </div>

                {/* Stats */}
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div class="glass-panel rounded-3xl p-6">
                        <p class="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Total</p>
                        <p id="statTotal" class="text-3xl font-black text-slate-900">—</p>
                    </div>
                    <div class="glass-panel rounded-3xl p-6">
                        <p class="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Unpaid</p>
                        <p id="statUnpaid" class="text-3xl font-black text-amber-600">—</p>
                    </div>
                    <div class="glass-panel rounded-3xl p-6">
                        <p class="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Paid</p>
                        <p id="statPaid" class="text-3xl font-black text-emerald-600">—</p>
                    </div>
                    <div class="glass-panel rounded-3xl p-6">
                        <p class="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Revenue</p>
                        <p id="statRevenue" class="text-3xl font-black text-indigo-600">—</p>
                    </div>
                </div>

                <div class="glass-panel rounded-[3rem] overflow-hidden shadow-2xl shadow-slate-200/50">
                    <table class="w-full text-left">
                        <thead class="bg-slate-50/40">
                            <tr>
                                <th class="py-6 px-10 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Client</th>
                                <th class="py-6 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Amount</th>
                                <th class="py-6 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Due Date</th>
                                <th class="py-6 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Status</th>
                                <th class="relative py-6 pl-3 pr-10 text-right"><span class="sr-only">Actions</span></th>
                            </tr>
                        </thead>
                        <tbody id="invoicesBody">
                            <tr><td colspan={5} class="px-10 py-8 text-center text-slate-400 font-semibold">Loading...</td></tr>
                        </tbody>
                    </table>
                </div>

                {/* Create Modal */}
                <div id="invoiceModal" class="fixed inset-0 z-[100] hidden overflow-y-auto">
                    <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xl" onclick="closeInvoiceModal()"></div>
                    <div class="flex min-h-full items-center justify-center p-6">
                        <div class="relative w-full max-w-lg bg-white rounded-[3rem] p-10 shadow-2xl">
                            <h3 class="text-2xl font-black text-slate-900 mb-8">New Invoice</h3>
                            <div class="space-y-5">
                                <div class="grid grid-cols-2 gap-4">
                                    <div>
                                        <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Client Name *</label>
                                        <input type="text" id="invClientName" placeholder="John Smith" class="premium-input w-full px-5 py-4 rounded-2xl border-2 border-slate-50 focus:border-indigo-500 outline-none font-bold text-sm" />
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Client Email</label>
                                        <input type="email" id="invClientEmail" placeholder="john@example.com" class="premium-input w-full px-5 py-4 rounded-2xl border-2 border-slate-50 focus:border-indigo-500 outline-none font-bold text-sm" />
                                    </div>
                                </div>
                                <div class="grid grid-cols-2 gap-4">
                                    <div>
                                        <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Amount ($)</label>
                                        <input type="number" id="invAmount" min="0" step="0.01" placeholder="350.00" class="premium-input w-full px-5 py-4 rounded-2xl border-2 border-slate-50 focus:border-indigo-500 outline-none font-bold text-sm" />
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Due Date</label>
                                        <input type="date" id="invDueDate" class="premium-input w-full px-5 py-4 rounded-2xl border-2 border-slate-50 focus:border-indigo-500 outline-none font-bold text-sm" />
                                    </div>
                                </div>
                                <div>
                                    <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Notes</label>
                                    <textarea id="invNotes" rows={3} placeholder="Optional notes..." class="premium-input w-full px-5 py-4 rounded-2xl border-2 border-slate-50 focus:border-indigo-500 outline-none font-bold text-sm resize-none"></textarea>
                                </div>
                            </div>
                            <div class="mt-8 flex gap-4">
                                <button onclick="closeInvoiceModal()" class="flex-1 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest text-slate-400 hover:bg-slate-50 transition">Cancel</button>
                                <button onclick="submitInvoice()" class="flex-[2] py-4 rounded-2xl bg-indigo-600 text-white font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-slate-900 transition">Create</button>
                            </div>
                        </div>
                    </div>
                </div>

                <script src="/js/modal-dialog.js"></script>
                <script src="/js/auth.js"></script>
                <script src="/js/invoices.js"></script>
            </div>
        </MainLayout>
    );
};
