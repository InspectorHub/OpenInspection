import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';
import { PageHeader } from '../components/page-header';

interface MetricsPageProps {
    appName?: string | undefined;
    branding?: BrandingConfig | undefined;
}

export function MetricsPage({ appName, branding }: MetricsPageProps) {
    return (
        <MainLayout title={`Metrics — ${appName || 'OpenInspection'}`} branding={branding}>
            <div x-data="metrics" class="space-y-6">
                <PageHeader
                    eyebrow="METRICS"
                    eyebrowColor="slate"
                    title="Metrics"
                    meta={
                        <span x-text="data ? `${periodLabel(period)} · ${data.totalInspections} inspections · ${fmt(data.totalRevenue)}` : 'Loading…'"></span>
                    }
                    actions={
                        <div class="flex gap-1 bg-slate-100 dark:bg-slate-700 rounded-md p-1">
                            {(['3m', '6m', '12m'] as const).map(p => (
                                <button
                                    x-on:click={`period='${p}'; load()`}
                                    x-bind:class={`period==='${p}' ? 'bg-white dark:bg-slate-600 shadow-sm text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500'`}
                                    class="h-6 px-3 rounded text-[12px] font-bold transition-all"
                                >{p}</button>
                            ))}
                        </div>
                    }
                />

                <div x-show="loading" class="text-sm text-slate-400 text-center py-10">Loading...</div>

                <div x-show="!loading && data">
                    {/* KPI cards */}
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                        <div class="bg-white border border-slate-200 rounded-xl p-5">
                            <div class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total Revenue</div>
                            <div class="text-xl font-bold text-slate-900" x-text="data ? fmt(data.totalRevenue) : '—'" />
                        </div>
                        <div class="bg-white border border-slate-200 rounded-xl p-5">
                            <div class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total Inspections</div>
                            <div class="text-xl font-bold text-slate-900" x-text="data ? data.totalInspections : '—'" />
                        </div>
                        <div class="bg-white border border-slate-200 rounded-xl p-5">
                            <div class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Avg Order Value</div>
                            <div class="text-xl font-bold text-slate-900" x-text="data ? fmt(data.avgOrderValue) : '—'" />
                        </div>
                    </div>

                    {/* Revenue chart */}
                    <div class="bg-white border border-slate-200 rounded-xl p-5 mb-6">
                        <div class="text-sm font-bold text-slate-700 mb-4">Monthly Revenue</div>
                        <canvas id="revenue-chart" height="80" />
                    </div>

                    {/* Inspection volume chart */}
                    <div class="bg-white border border-slate-200 rounded-xl p-5 mb-6">
                        <div class="text-sm font-bold text-slate-700 mb-4">Monthly Inspection Volume</div>
                        <canvas id="volume-chart" height="80" />
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
                            <div class="relative" style="height:240px">
                                <canvas id="service-donut" />
                            </div>
                            <div x-show="!data || !data.serviceBreakdown.length" class="text-xs text-slate-400 text-center mt-2">No service data yet</div>
                        </div>
                    </div>
                </div>

                {/* Design System 0520 subsystem E P7 — AnalyticsPanel.
                    Reads /api/analytics/growth + /api/analytics/findings-
                    heatmap on init; SVG polyline + heatmap grid rendered
                    inline (no Chart.js dep). */}
                <section x-data="analyticsPanel()" {...{ 'x-init': 'init()' }}
                         class="mt-8 space-y-6">
                    <div class="bg-white border border-slate-200 rounded-xl p-5">
                        <div class="text-sm font-bold text-slate-700 mb-3">Inspections per month</div>
                        <svg viewBox="0 0 600 200" class="w-full h-48" preserveAspectRatio="none">
                            <polyline {...{ ':points': 'growthPath' }}
                                      fill="none" stroke="#6366f1" stroke-width="2" />
                        </svg>
                        <div class="grid grid-cols-12 gap-1 mt-2 text-[10px] text-slate-400">
                            <template {...{ 'x-for': 'm in (growth?.months || [])', ':key': 'm.ym' }}>
                                <div class="text-center" x-text="m.ym.slice(5)" />
                            </template>
                        </div>
                        <p class="text-xs text-slate-400 mt-2" x-show="loading">Loading…</p>
                    </div>

                    <div class="bg-white border border-slate-200 rounded-xl p-5">
                        <div class="text-sm font-bold text-slate-700 mb-3">Findings heatmap</div>
                        <div class="grid grid-cols-[200px_1fr_1fr_1fr] gap-1 text-xs">
                            <div class="text-[10px] font-bold uppercase tracking-widest text-slate-400">Section</div>
                            <div class="text-[10px] font-bold uppercase tracking-widest text-emerald-600 text-center">Satisfactory</div>
                            <div class="text-[10px] font-bold uppercase tracking-widest text-amber-600 text-center">Monitor</div>
                            <div class="text-[10px] font-bold uppercase tracking-widest text-rose-600 text-center">Defect</div>
                            <template {...{ 'x-for': 'row in heatmapRows', ':key': 'row.section' }}>
                                <template>
                                    <div class="font-medium" x-text="row.section" />
                                    <div class="text-center"
                                         {...{ ':style': "`background-color: rgba(16,185,129,${row.satPct})`", 'x-text': 'row.satCount' }} />
                                    <div class="text-center"
                                         {...{ ':style': "`background-color: rgba(245,158,11,${row.monitorPct})`", 'x-text': 'row.monitorCount' }} />
                                    <div class="text-center"
                                         {...{ ':style': "`background-color: rgba(239,68,68,${row.defectPct})`", 'x-text': 'row.defectCount' }} />
                                </template>
                            </template>
                        </div>
                        <p class="text-xs text-slate-400 mt-2" x-show="heatmapRows.length === 0 && !loading">No findings yet.</p>
                    </div>
                </section>

                <script src="/js/auth.js" />
                <script src="/vendor/chart.min.js" />
                <script src="/js/metrics.js" />
                {/* Design System 0520 subsystem E P7 — AnalyticsPanel factory. */}
                <script src="/js/analytics-panel.js" />
            </div>
        </MainLayout>
    );
}
