import { BareLayout } from '../layouts/main-layout';
import { AtmosphericBg } from '../components/atmospheric-bg';
import { AgentDashboardHero } from '../components/agent-dashboard-hero';
import { ReportStatusPill } from '../components/report-status-pill';
import { BrandingConfig } from '../../types/auth';
import { PageHeader } from '../components/page-header';

export const AgentDashboardPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    const logoUrl = branding?.logoUrl;

    return (
        <BareLayout title={`${siteName} | Agent Portal`} branding={branding}>
            <div class="min-h-screen bg-slate-50 text-slate-900 overflow-x-hidden relative">
                <AtmosphericBg />

                {/* Floating Navigation */}
                <nav class="sticky top-6 mx-auto max-w-7xl px-6 z-50">
                    <div class="glass-panel flex h-20 items-center justify-between px-8 rounded-lg shadow-md/20">
                        <div class="flex items-center gap-4">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 flex items-center justify-center flex-shrink-0">
                                    <img src={logoUrl || '/logo.svg'} alt={siteName} class="w-full h-full object-contain" />
                                </div>
                                <span class="text-xl font-bold tracking-tight text-slate-900">{siteName}</span>
                            </div>
                        </div>
                        <div class="flex items-center gap-6">
                            <a href="/dashboard" class="text-sm font-bold text-slate-500 hover:text-indigo-600 transition-all">Inspector Portal</a>
                            <div class="h-6 w-px bg-slate-200"></div>
                            <button id="logoutBtn" class="premium-button text-[10px] uppercase font-bold tracking-widest px-6 py-2.5 rounded-xl bg-slate-900 text-white hover:bg-black">Sign out</button>
                        </div>
                    </div>
                </nav>

                {/* Main Content — combines Sub-spec B PageHeader with Sub-spec D
                    hero strip + share-with-buyer + status pill via the
                    `agentDashboardState` Alpine factory. */}
                <main
                    class="py-10 animate-slide-in relative z-10"
                    x-data="agentDashboardState"
                    x-init="init && init()"
                >
                    <div class="mx-auto max-w-7xl px-6 lg:px-8 space-y-6">
                        {/* Sub-spec D Task 7 — Hero strip. Address + share-with-buyer
                            CTA. Pulls live data from Alpine `hero` once the referral
                            list loads (see public/js/agent-dashboard.js). */}
                        <AgentDashboardHero alpine />

                        {/* PageHeader (Sub-spec B B-2) sits below the hero. Status
                            pill (Sub-spec D D-7) folded into the actions slot so it
                            still surfaces lifecycle state next to the title. */}
                        <div x-data="agentMeta" class="mb-10">
                            <PageHeader
                                eyebrow="AGENT VIEW"
                                eyebrowColor="indigo"
                                title="Referral Dashboard"
                                meta={
                                    <span x-text="`${total || 0} referral${total === 1 ? '' : 's'}${pending ? ' · ' + pending + ' pending' : ''}`"></span>
                                }
                                actions={
                                    <span x-show="hero.status" class="align-middle">
                                        <ReportStatusPill status="published" />
                                    </span>
                                }
                            />
                        </div>

                        {/* Referral List */}
                        <div class="glass-panel rounded-xl overflow-hidden shadow-md/10">
                            <div class="overflow-x-auto">
                                <table class="min-w-full">
                                    <thead>
                                        <tr class="bg-slate-50/50">
                                            <th class="py-6 pl-10 pr-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Property Address</th>
                                            <th class="px-6 py-6 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Client Info</th>
                                            <th class="px-6 py-6 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Status</th>
                                            <th class="px-6 py-6 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Created</th>
                                            <th class="px-6 py-6 text-right text-[10px] font-bold uppercase tracking-widest text-slate-400 pr-10">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody id="reportsList" class="divide-y divide-slate-100">
                                        <tr id="loadingRow">
                                            <td colspan={5} class="py-32 text-center">
                                                <div class="flex flex-col items-center gap-4">
                                                    <div class="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin shadow-md"></div>
                                                    <p class="text-sm font-bold text-slate-400 animate-pulse">Loading...</p>
                                                </div>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Spec 5G — Leaderboard card (closes Round 27 audit
                            orphan). Shows top 10 agents by referral count.
                            Renders even when this user has no referrals — useful
                            social context. */}
                        <div class="mt-6 glass-panel rounded-md p-6">
                            <div class="flex items-center justify-between mb-4">
                                <h3 class="text-sm font-bold text-slate-900">Office Leaderboard</h3>
                                <span class="text-[10px] font-bold uppercase tracking-widest text-slate-400">Top 10 by referrals</span>
                            </div>
                            <table class="min-w-full">
                                <tbody id="leaderboardList">
                                    <tr><td colspan={4} class="py-12 text-center text-xs text-slate-400 italic">Loading leaderboard…</td></tr>
                                </tbody>
                            </table>
                        </div>

                        {/* Empty State Template (handled by JS) */}
                        <div id="emptyState" class="hidden py-40 text-center">
                            <div class="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-8 border border-slate-100 shadow-inner">
                                <svg class="w-10 h-10 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                            </div>
                            <h3 class="text-xl font-bold text-slate-900 mb-2">No Referrals Found</h3>
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
