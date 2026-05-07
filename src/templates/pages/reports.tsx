import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

export const ReportsPage = ({ branding }: { branding?: BrandingConfig }) => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout title={`${siteName} | Reports`} branding={branding}>
            <div class="space-y-6 animate-fade-in">
                <div class="flex flex-col gap-3">
                    <span class="self-start px-4 py-1.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-[0.2em]">Reports</span>
                    <div class="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                        <div>
                            <h1 class="text-3xl font-bold tracking-tight text-slate-900">Reports</h1>
                            <p class="text-lg text-slate-500 max-w-2xl font-semibold leading-relaxed">Published and ready-to-deliver inspection reports.</p>
                        </div>
                        <div class="flex items-center gap-3">
                            <input id="reportsSearch" type="search" placeholder="Search address, client..."
                                   class="w-64 px-5 py-3 rounded-2xl border-0 ring-2 ring-slate-100 focus:ring-2 focus:ring-indigo-600 outline-none transition-all font-semibold text-sm placeholder:text-slate-300 bg-white" />
                        </div>
                    </div>
                </div>

                <div class="flex items-center gap-2 flex-wrap">
                    <button data-status="all" class="report-tab bg-white text-indigo-700 shadow-sm px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all">All <span id="report-count-all" class="ml-1.5 text-slate-400">0</span></button>
                    <button data-status="ready" class="report-tab text-slate-500 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-white transition-all">Ready for Review <span id="report-count-ready" class="ml-1.5 text-amber-500">0</span></button>
                    <button data-status="delivered" class="report-tab text-slate-500 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-white transition-all">Delivered <span id="report-count-delivered" class="ml-1.5 text-emerald-500">0</span></button>
                    <button data-status="signed" class="report-tab text-slate-500 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-white transition-all">Signed <span id="report-count-signed" class="ml-1.5 text-violet-500">0</span></button>
                </div>

                <div class="glass-panel relative overflow-hidden rounded-xl min-h-[400px] shadow-md">
                    <div class="hidden md:block">
                        <table class="w-full">
                            <thead>
                                <tr class="bg-slate-50/40">
                                    <th class="px-6 py-5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Property</th>
                                    <th class="px-6 py-5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Client</th>
                                    <th class="px-6 py-5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Date</th>
                                    <th class="px-6 py-5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Status</th>
                                    <th class="px-6 py-5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Payment</th>
                                    <th class="px-6 py-5"></th>
                                </tr>
                            </thead>
                            <tbody id="reportsList" class="divide-y divide-slate-100"></tbody>
                        </table>
                    </div>
                    <div id="reportsCardList" class="md:hidden flex flex-col gap-3 p-4"></div>
                </div>

                <script src="/js/auth.js"></script>
                <script src="/js/toast.js"></script>
                <script src="/js/reports.js"></script>
            </div>
        </MainLayout>
    );
};
