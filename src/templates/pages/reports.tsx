import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';
import { PageHeader } from '../components/page-header';

export const ReportsPage = ({ branding }: { branding?: BrandingConfig }) => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout title={`${siteName} | Reports`} branding={branding}>
            <div class="space-y-6 animate-fade-in">
                <div x-data="reportsMeta">
                    <PageHeader
                        eyebrow="REPORTS"
                        eyebrowColor="emerald"
                        title="Reports"
                        meta={<span x-text="metaText"></span>}
                        actions={
                            <input
                                id="reportsSearch"
                                type="search"
                                placeholder="Search address, client..."
                                class="h-8 w-64 px-3 rounded-md border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-[13px] font-medium placeholder:text-slate-400 bg-white"
                            />
                        }
                    />
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
