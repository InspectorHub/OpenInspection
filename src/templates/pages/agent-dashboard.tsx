import { BareLayout } from '../layouts/main-layout';
import { AtmosphericBg } from '../components/atmospheric-bg';
import { BrandingConfig } from '../../types/auth';

export const AgentDashboardPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    const logoUrl = branding?.logoUrl;

    return (
        <BareLayout title={`${siteName} | Agent Portal`} branding={branding}>
            <div class="min-h-screen bg-slate-50 text-slate-900 overflow-x-hidden relative">
                <AtmosphericBg />

                {/* Floating Navigation */}
                <nav class="sticky top-6 mx-auto max-w-7xl px-6 z-50">
                    <div class="glass-panel flex h-20 items-center justify-between px-8 rounded-[2rem] shadow-2xl shadow-indigo-100/20">
                        <div class="flex items-center gap-8">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 flex items-center justify-center flex-shrink-0">
                                    <img src={logoUrl || '/logo.svg'} alt={siteName} class="w-full h-full object-contain" />
                                </div>
                                <span class="text-2xl font-black tracking-tightest text-slate-900">{siteName}</span>
                            </div>
                        </div>
                        <div class="flex items-center gap-6">
                            <a href="/dashboard" class="text-sm font-bold text-slate-500 hover:text-indigo-600 transition-all">Inspector Portal</a>
                            <div class="h-6 w-px bg-slate-200"></div>
                            <button id="logoutBtn" class="premium-button text-[10px] uppercase font-bold tracking-widest px-6 py-2.5 rounded-xl bg-slate-900 text-white hover:bg-black">Sign out</button>
                        </div>
                    </div>
                </nav>

                {/* Main Content */}
                <main class="py-16 animate-slide-in relative z-10">
                    <div class="mx-auto max-w-7xl px-6 lg:px-8">
                        <div class="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-16">
                            <div>
                                <div class="inline-flex items-center gap-2 px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-black uppercase tracking-widest mb-4 ring-1 ring-indigo-100">
                                    <span class="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-pulse"></span>
                                    Agent Portal
                                </div>
                                <h1 class="text-5xl font-black tracking-tightest text-slate-900 mb-4">Referral Dashboard</h1>
                                <p class="text-xl text-slate-400 font-medium max-w-2xl leading-relaxed">Track shared inspections and follow up on client reports in real-time.</p>
                            </div>
                            
                            <div class="glass-panel p-6 rounded-3xl min-w-[240px]">
                                <p class="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Total Referrals</p>
                                <h2 id="statTotal" class="text-4xl font-black text-slate-900 tabular-nums">0</h2>
                            </div>
                        </div>

                        {/* Referral List */}
                        <div class="glass-panel rounded-[2.5rem] overflow-hidden shadow-2xl shadow-indigo-100/10">
                            <div class="overflow-x-auto">
                                <table class="min-w-full">
                                    <thead>
                                        <tr class="bg-slate-50/50">
                                            <th class="py-6 pl-10 pr-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Property Address</th>
                                            <th class="px-6 py-6 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Client Info</th>
                                            <th class="px-6 py-6 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Status</th>
                                            <th class="px-6 py-6 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Created</th>
                                            <th class="px-6 py-6 text-right text-[10px] font-black uppercase tracking-widest text-slate-400 pr-10">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody id="reportsList" class="divide-y divide-slate-100">
                                        <tr id="loadingRow">
                                            <td colspan={5} class="py-32 text-center">
                                                <div class="flex flex-col items-center gap-4">
                                                    <div class="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin shadow-xl shadow-indigo-100"></div>
                                                    <p class="text-sm font-bold text-slate-400 animate-pulse">Loading...</p>
                                                </div>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Empty State Template (handled by JS) */}
                        <div id="emptyState" class="hidden py-40 text-center">
                            <div class="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-8 border border-slate-100 shadow-inner">
                                <svg class="w-10 h-10 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                            </div>
                            <h3 class="text-2xl font-black text-slate-900 mb-2">No Referrals Found</h3>
                            <p class="text-slate-400 font-medium">Inspections referred by you will appear here once they are scheduled.</p>
                        </div>
                    </div>
                </main>

                <script src="/js/auth.js"></script>
                <script src="/js/agent-dashboard.js"></script>
            </div>
        </BareLayout>
    );
};
