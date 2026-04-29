import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

export const ContactsPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout title={`${siteName} | Contacts`} branding={branding}>
            <div class="space-y-10 animate-fade-in">
                <div class="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <span class="inline-flex items-center rounded-lg bg-emerald-600/10 px-3 py-1 text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] ring-1 ring-inset ring-emerald-600/20 mb-4">Contacts</span>
                        <h1 class="text-5xl font-black tracking-tight text-slate-900">Contacts</h1>
                        <p class="text-lg text-slate-500 font-semibold mt-2">Manage agents and clients.</p>
                    </div>
                    <div class="flex gap-3">
                        <select id="filterType" onchange="filterContacts()" class="premium-input px-5 py-4 rounded-2xl text-sm font-bold border-0 ring-2 ring-slate-100 bg-white focus:ring-indigo-500">
                            <option value="">All Types</option>
                            <option value="agent">Agents</option>
                            <option value="client">Clients</option>
                        </select>
                        <button onclick="showCreateModal()" class="premium-button flex items-center gap-2 px-8 py-4 rounded-2xl bg-indigo-600 text-white font-bold shadow-xl hover:bg-slate-900 transition">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                            Add Contact
                        </button>
                    </div>
                </div>

                <div class="glass-panel rounded-[3rem] overflow-hidden shadow-2xl shadow-slate-200/50">
                    <table class="w-full text-left">
                        <thead class="bg-slate-50/40">
                            <tr>
                                <th class="py-6 px-10 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Name</th>
                                <th class="py-6 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Type</th>
                                <th class="py-6 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Email</th>
                                <th class="py-6 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Phone</th>
                                <th class="py-6 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Agency</th>
                                <th class="py-6 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Inspections</th>
                                <th class="relative py-6 pl-3 pr-10 text-right"><span class="sr-only">Actions</span></th>
                            </tr>
                        </thead>
                        <tbody id="contactsBody">
                            <tr><td colspan={7} class="px-10 py-8 text-center text-slate-400 font-semibold">Loading...</td></tr>
                        </tbody>
                    </table>
                </div>

                {/* Create/Edit Modal */}
                <div id="contactModal" class="fixed inset-0 z-[100] hidden overflow-y-auto">
                    <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xl" onclick="closeContactModal()"></div>
                    <div class="flex min-h-full items-center justify-center p-6">
                        <div class="relative w-full max-w-lg bg-white rounded-[3rem] p-10 shadow-2xl">
                            <h3 id="contactModalTitle" class="text-2xl font-black text-slate-900 mb-8">Add Contact</h3>
                            <input type="hidden" id="editContactId" />
                            <div class="space-y-5">
                                <div>
                                    <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Type</label>
                                    <select id="contactType" class="premium-input w-full px-5 py-4 rounded-2xl border-2 border-slate-50 focus:border-indigo-500 outline-none font-bold text-sm bg-white">
                                        <option value="agent">Agent</option>
                                        <option value="client">Client</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Full Name *</label>
                                    <input type="text" id="contactName" placeholder="Jane Smith" class="premium-input w-full px-5 py-4 rounded-2xl border-2 border-slate-50 focus:border-indigo-500 outline-none font-bold text-sm" />
                                </div>
                                <div class="grid grid-cols-2 gap-4">
                                    <div>
                                        <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Email</label>
                                        <input type="email" id="contactEmail" placeholder="jane@realty.com" class="premium-input w-full px-5 py-4 rounded-2xl border-2 border-slate-50 focus:border-indigo-500 outline-none font-bold text-sm" />
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Phone</label>
                                        <input type="tel" id="contactPhone" placeholder="(555) 123-4567" class="premium-input w-full px-5 py-4 rounded-2xl border-2 border-slate-50 focus:border-indigo-500 outline-none font-bold text-sm" />
                                    </div>
                                </div>
                                <div>
                                    <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Agency</label>
                                    <input type="text" id="contactAgency" placeholder="Sunrise Realty" class="premium-input w-full px-5 py-4 rounded-2xl border-2 border-slate-50 focus:border-indigo-500 outline-none font-bold text-sm" />
                                </div>
                            </div>
                            <div class="mt-8 flex gap-4">
                                <button onclick="closeContactModal()" class="flex-1 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest text-slate-400 hover:bg-slate-50 transition">Cancel</button>
                                <button onclick="submitContact()" class="flex-[2] py-4 rounded-2xl bg-indigo-600 text-white font-black text-[10px] uppercase tracking-widest shadow-xl hover:bg-slate-900 transition">Save</button>
                            </div>
                        </div>
                    </div>
                </div>

                <script src="/js/modal-dialog.js"></script>
                <script src="/js/auth.js"></script>
                <script src="/js/contacts.js"></script>
            </div>
        </MainLayout>
    );
};
