import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

interface MetricsPageProps {
    appName?: string | undefined;
    branding?: BrandingConfig | undefined;
}

export function MetricsPage({ appName, branding }: MetricsPageProps) {
    return (
        <MainLayout title={`Metrics — ${appName || 'OpenInspection'}`} branding={branding}>
            <div x-data="metrics">
                <div class="flex items-center justify-between mb-6">
                    <h1 class="text-xl font-bold text-slate-900">Metrics</h1>
                    <div class="flex gap-1 bg-slate-100 rounded-lg p-1">
                        {(['3m', '6m', '12m'] as const).map(p => (
                            <button
                                x-on:click={`period='${p}'; load()`}
                                x-bind:class={`period==='${p}' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400'`}
                                class="px-3 py-1 rounded text-xs font-bold transition-all"
                            >{p}</button>
                        ))}
                    </div>
                </div>

                <div x-show="loading" class="text-sm text-slate-400 text-center py-16">Loading...</div>

                <div x-show="!loading && data">
                    {/* KPI cards */}
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                        <div class="bg-white border border-slate-200 rounded-xl p-5">
                            <div class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total Revenue</div>
                            <div class="text-2xl font-black text-slate-900" x-text="data ? fmt(data.totalRevenue) : '—'" />
                        </div>
                        <div class="bg-white border border-slate-200 rounded-xl p-5">
                            <div class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total Inspections</div>
                            <div class="text-2xl font-black text-slate-900" x-text="data ? data.totalInspections : '—'" />
                        </div>
                        <div class="bg-white border border-slate-200 rounded-xl p-5">
                            <div class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Avg Order Value</div>
                            <div class="text-2xl font-black text-slate-900" x-text="data ? fmt(data.avgOrderValue) : '—'" />
                        </div>
                    </div>

                    {/* Revenue chart */}
                    <div class="bg-white border border-slate-200 rounded-xl p-5 mb-6">
                        <div class="text-sm font-bold text-slate-700 mb-4">Monthly Revenue</div>
                        <canvas id="revenue-chart" height="80" />
                    </div>

                    {/* Top Agents + Service Breakdown */}
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="bg-white border border-slate-200 rounded-xl p-5">
                            <div class="text-sm font-bold text-slate-700 mb-3">Top Referring Agents</div>
                            <div class="space-y-2">
                                <template x-for="(agent, i) in (data ? data.topAgents.slice(0, 5) : [])" x-key="i">
                                    <div class="flex items-center justify-between text-sm">
                                        <span class="text-slate-700 font-medium" x-text="agent.agentName" />
                                        <div class="text-right">
                                            <span class="font-bold text-slate-900" x-text="agent.count + ' insp'" />
                                            <span class="text-slate-400 ml-2 text-xs" x-text="fmt(agent.revenue)" />
                                        </div>
                                    </div>
                                </template>
                                <div x-show="!data || !data.topAgents.length" class="text-xs text-slate-400">No agent data yet</div>
                            </div>
                        </div>

                        <div class="bg-white border border-slate-200 rounded-xl p-5">
                            <div class="text-sm font-bold text-slate-700 mb-3">Service Breakdown</div>
                            <div class="space-y-2">
                                <template x-for="(svc, i) in (data ? data.serviceBreakdown.slice(0, 5) : [])" x-key="i">
                                    <div class="flex items-center justify-between text-sm">
                                        <span class="text-slate-700 font-medium" x-text="svc.serviceName" />
                                        <span class="font-bold text-slate-900" x-text="svc.count + ' ×'" />
                                    </div>
                                </template>
                                <div x-show="!data || !data.serviceBreakdown.length" class="text-xs text-slate-400">No service data yet</div>
                            </div>
                        </div>
                    </div>
                </div>

                <script src="/js/auth.js" />
                <script src="/vendor/chart.min.js" />
                <script src="/js/metrics.js" />
            </div>
        </MainLayout>
    );
}
