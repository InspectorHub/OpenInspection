import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

export const DashboardPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';

    return (
        <MainLayout title={`${siteName} | Dashboard`} branding={branding}>
            <div class="space-y-12 animate-fade-in">
                
                {/* Header Section */}
                <div class="flex flex-col md:flex-row md:items-end justify-between gap-8">
                    <div class="space-y-4">
                        <div class="flex items-center gap-3">
                            <span class="inline-flex items-center rounded-lg bg-indigo-600/10 px-3 py-1 text-[10px] font-black text-indigo-600 uppercase tracking-[0.2em] ring-1 ring-inset ring-indigo-600/20">Dashboard</span>
                        </div>
                        <h1 class="text-5xl font-black tracking-tight text-slate-900 sm:text-6xl text-gradient">Inspections</h1>
                        <p class="text-lg text-slate-500 max-w-2xl font-semibold leading-relaxed">Manage your inspections.</p>
                    </div>
                    
                    <div class="flex items-center gap-4">
                        <button type="button" onclick="showCreateModal()" class="premium-button group relative flex items-center justify-center gap-3 overflow-hidden px-10 py-5 rounded-[1.5rem] bg-indigo-600 text-white font-bold shadow-2xl shadow-indigo-100 hover:bg-slate-900 hover:shadow-indigo-200 active:scale-95 transition-all">
                            <svg class="w-5 h-5 transition-transform group-hover:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                            </svg>
                            New Inspection
                        </button>
                    </div>
                </div>

                {/* Statistics Grid */}
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
                    {[
                        { label: 'Active Jobs', id: 'statActive', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', color: 'indigo' },
                        { label: 'In Progress', id: 'statProgress', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z', color: 'blue' },
                        { label: 'Ready for Review', id: 'statReview', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', color: 'amber' },
                        { label: 'Completed', id: 'statCompleted', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', color: 'emerald' }
                    ].map((stat, i) => (
                        <div key={stat.id} class="glass-card group p-8 rounded-[2.5rem] animate-fade-in" style={`animation-delay: ${0.1 + i * 0.05}s`}>
                            <div class="flex items-center justify-between mb-6">
                                <div class={`w-14 h-14 rounded-2xl bg-${stat.color}-600/10 text-${stat.color}-600 flex items-center justify-center group-hover:scale-110 group-hover:bg-${stat.color}-600 group-hover:text-white transition-all duration-300 shadow-sm`}>
                                   <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={stat.icon}></path></svg>
                                </div>
                                <span class="sr-only">Live</span>
                            </div>
                            <h3 class="text-4xl font-black text-slate-900 tracking-tightest mb-1" id={stat.id}>0</h3>
                            <p class="text-sm font-bold text-slate-500 uppercase tracking-tight">{stat.label}</p>
                        </div>
                    ))}
                </div>

                {/* Inspections Table Container */}
                <div class="glass-panel relative overflow-hidden rounded-[3rem] min-h-[500px] animate-fade-in shadow-2xl shadow-slate-200/50" style="animation-delay: 0.3s">
                    <div class="px-10 py-8 border-b border-slate-100/50 flex flex-col sm:flex-row items-center justify-between gap-6">
                        <div class="flex items-center gap-6">
                             <h2 class="text-2xl font-black text-slate-900 tracking-tightest">Recent Inspections</h2>
                        </div>
                        <div class="flex items-center gap-4 w-full sm:w-auto">
                            <select id="filterInspector" aria-label="Filter by inspector" class="premium-input px-4 py-4 rounded-2xl text-sm font-bold border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-indigo-600 transition-all bg-white min-w-[160px]">
                                <option value="">All Inspectors</option>
                            </select>
                            <div class="relative w-full sm:w-80 group">
                                <div class="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-blue-500 rounded-2xl blur opacity-0 group-focus-within:opacity-10 transition-opacity"></div>
                                <input type="text" id="filterSearch" placeholder="Search entries..." class="premium-input relative w-full pl-12 pr-6 py-4 rounded-2xl text-sm font-bold border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-indigo-600 transition-all placeholder:text-slate-400" />
                                <svg class="w-5 h-5 text-slate-400 absolute left-4 top-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                            </div>
                        </div>
                    </div>

                    {/* Unconfirmed warning banner */}
                    <div id="unconfirmedBanner" class="mx-8 mb-0 mt-4 px-4 py-3 rounded-xl flex items-center gap-3 text-sm font-semibold" style="display:none; background: #fef2f2; border: 1px solid #fecaca; color: #dc2626;">
                        <svg class="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>
                        <span id="unconfirmedBannerText"></span>
                        <button onclick="setTab('unconfirmed')" class="ml-auto text-xs underline font-bold">View</button>
                    </div>

                    {/* Tab strip */}
                    <div class="px-8 pt-4 pb-0 flex gap-1 flex-wrap" id="inspectionTabStrip">
                        {[
                            { key: 'all',         label: 'All',         color: '#6366f1' },
                            { key: 'today',       label: 'Today',       color: '#f59e0b' },
                            { key: 'upcoming',    label: 'Upcoming',    color: '#3b82f6' },
                            { key: 'past',        label: 'Past',        color: '#94a3b8' },
                            { key: 'unconfirmed', label: 'Unconfirmed', color: '#ef4444' },
                            { key: 'in_progress', label: 'In Progress', color: '#22c55e' },
                        ].map(({ key, label, color }) => (
                            <button
                                key={key}
                                data-tab={key}
                                onclick={`setTab('${key}')`}
                                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all text-slate-500"
                            >
                                {label}
                                <span id={`tab-count-${key}`} class="text-white text-[9px] font-black rounded-full px-1.5 py-0.5 min-w-[18px] text-center" style={`background: ${color}`}>0</span>
                            </button>
                        ))}
                    </div>

                    <div class="overflow-x-auto custom-scrollbar">
                        <table class="w-full text-left">
                            <thead class="bg-slate-50/40">
                                <tr>
                                    <th class="py-6 px-10 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Address</th>
                                    <th class="py-6 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Client</th>
                                    <th class="py-6 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Inspector</th>
                                    <th class="py-6 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Date</th>
                                    <th class="py-6 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Status</th>
                                    <th class="py-6 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Fee</th>
                                    <th class="relative py-6 pl-3 pr-10 text-right"><span class="sr-only">Actions</span></th>
                                </tr>
                            </thead>
                            <tbody id="inspectionsList" class="divide-y divide-slate-100/50">
                                <tr id="loadingRow">
                                    <td colspan={7} class="py-32 text-center">
                                        <div class="flex flex-col items-center gap-6">
                                            <div class="relative w-16 h-16">
                                                <div class="absolute inset-0 border-[6px] border-indigo-50 rounded-full"></div>
                                                <div class="absolute inset-0 border-[6px] border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                                            </div>
                                            <p class="text-sm font-black text-slate-300 uppercase tracking-[0.3em]">Loading</p>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Initializing Inspection Modal */}
                <div id="createModal" class="fixed inset-0 z-[100] hidden overflow-y-auto">
                    <div class="fixed inset-0 bg-slate-900/60 backdrop-blur-xl transition-opacity animate-fade-in" onclick="closeModal()"></div>
                    <div class="flex min-h-full items-center justify-center p-6">
                        <div role="dialog" aria-modal="true" class="relative w-full max-w-2xl transform overflow-hidden rounded-[3.5rem] bg-white p-12 text-left shadow-[0_32px_128px_-16px_rgba(0,0,0,0.3)] animate-fade-in border border-white/40">
                            <div class="absolute top-10 right-10">
                                <button onclick="closeModal()" aria-label="Close dialog" class="group p-3 text-slate-300 hover:text-slate-900 rounded-2xl hover:bg-slate-50 transition-all">
                                    <svg class="w-6 h-6 transition-transform group-hover:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"></path></svg>
                                </button>
                            </div>
                            
                            <div class="mb-10">
                                <div class="w-14 h-14 bg-emerald-600/10 rounded-2xl flex items-center justify-center text-emerald-600 mb-6">
                                    <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"></path></svg>
                                </div>
                                <h3 class="text-3xl font-black text-slate-900 tracking-tightest mb-2 leading-none">New Inspection</h3>
                                <p class="text-sm text-slate-500 font-semibold tracking-tight">Enter the details for this inspection.</p>
                            </div>
                            
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                                <div class="space-y-2 md:col-span-2">
                                    <label class="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Property Address</label>
                                    <input type="text" id="propAddress" placeholder="e.g., 742 Evergreen Terrace, Springfield"
                                        class="premium-input w-full px-6 py-4 rounded-2xl border-2 border-slate-50 focus:border-emerald-600 outline-none transition-all font-bold text-sm" />
                                </div>
                                <div class="space-y-2">
                                    <label class="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Template</label>
                                    <select id="templateId" class="premium-input w-full px-6 py-4 rounded-2xl border-2 border-slate-50 focus:border-emerald-600 outline-none transition-all font-bold text-sm bg-white">
                                        <option value="">Select a template...</option>
                                    </select>
                                    <p id="noTemplateHint" class="hidden text-xs text-amber-600 font-semibold mt-1 ml-1">
                                        No templates found. <a href="/templates" class="underline hover:text-amber-800">Create a template</a> first.
                                    </p>
                                </div>
                                <div class="space-y-2">
                                    <label class="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Inspection Date &amp; Time</label>
                                    <input type="datetime-local" id="inspectionDate"
                                        class="premium-input w-full px-6 py-4 rounded-2xl border-2 border-slate-50 focus:border-emerald-600 outline-none transition-all font-bold text-sm" />
                                </div>
                                <div class="space-y-2">
                                    <label class="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Client Name</label>
                                    <input type="text" id="clientName" placeholder="e.g., John Doe"
                                        class="premium-input w-full px-6 py-4 rounded-2xl border-2 border-slate-50 focus:border-emerald-600 outline-none transition-all font-bold text-sm" />
                                </div>
                                <div class="space-y-2">
                                    <label class="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Client Email</label>
                                    <input type="email" id="clientEmail" placeholder="e.g., john@example.com"
                                        class="premium-input w-full px-6 py-4 rounded-2xl border-2 border-slate-50 focus:border-emerald-600 outline-none transition-all font-bold text-sm" />
                                </div>
                                <div class="space-y-2">
                                    <label class="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Client Phone</label>
                                    <input type="tel" id="clientPhone" placeholder="e.g., (555) 123-4567"
                                        class="premium-input w-full px-6 py-4 rounded-2xl border-2 border-slate-50 focus:border-emerald-600 outline-none transition-all font-bold text-sm" />
                                </div>
                                <div class="space-y-2">
                                    <label class="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Assign Inspector</label>
                                    <select id="inspectorId" class="premium-input w-full px-6 py-4 rounded-2xl border-2 border-slate-50 focus:border-emerald-600 outline-none transition-all font-bold text-sm bg-white">
                                        <option value="">Self-assignment</option>
                                    </select>
                                </div>
                                <div class="space-y-2">
                                    <label class="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Referring Agent</label>
                                    <select id="agentId" class="premium-input w-full px-6 py-4 rounded-2xl border-2 border-slate-50 focus:border-emerald-600 outline-none transition-all font-bold text-sm bg-white">
                                        <option value="">None</option>
                                    </select>
                                </div>
                            </div>

                            {/* Services selection */}
                            <div id="servicesSection" style="display:none" class="mb-4">
                                <div class="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-3">Services</div>
                                <div id="servicesList" class="space-y-2 max-h-48 overflow-y-auto"></div>
                                <div id="serviceTotalBar" style="display:none" class="mt-3">
                                    <div class="flex items-center gap-2 mb-2">
                                        <input id="discountCodeInput" type="text" placeholder="Discount code"
                                               class="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 uppercase font-bold" />
                                        <button onclick="validateDiscount()"
                                                class="text-xs px-3 py-1.5 bg-slate-100 rounded-lg font-semibold text-slate-700">Apply</button>
                                    </div>
                                    <div id="discountError" style="display:none" class="text-xs text-red-500 mb-1"></div>
                                    <div class="flex justify-between items-center bg-slate-900 text-white rounded-xl px-4 py-3">
                                        <div>
                                            <div class="text-xs font-bold text-slate-400">TOTAL</div>
                                            <div id="serviceCountLabel" class="text-xs text-slate-500"></div>
                                        </div>
                                        <div class="text-right">
                                            <div id="serviceTotalAmount" class="text-lg font-black">$0.00</div>
                                            <div id="serviceDiscountLine" style="display:none" class="text-xs text-green-400"></div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="pt-4 flex gap-4">
                                <button type="button" onclick="closeModal()" class="flex-1 py-4.5 rounded-2xl font-black text-[10px] uppercase tracking-widest text-slate-400 hover:bg-slate-50 transition-all">
                                    Cancel
                                </button>
                                <button type="button" onclick="submitInspection()" id="submitInsBtn" class="premium-button flex-[2] py-4.5 rounded-2xl bg-indigo-600 text-white font-black text-[10px] uppercase tracking-[0.2em] shadow-2xl hover:bg-slate-900 transition-all active:scale-95">
                                    Create Inspection
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <script src="/js/modal-dialog.js"></script>
                <script src="/js/auth.js"></script>
                <script src="/js/dashboard.js"></script>
            </div>
        </MainLayout>
    );
};
