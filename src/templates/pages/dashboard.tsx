import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';
import { CancelModal } from '../components/cancel-modal';
import { Modal } from '../components/modal';
import { PageHeader } from '../components/page-header';
import { CustomizeColumnsModal } from '../components/customize-columns-modal';
import { InspectionRow } from '../components/inspection-row';

export const DashboardPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';

    return (
        <MainLayout title={`${siteName} | Dashboard`} branding={branding}>
            <div class="space-y-6 animate-fade-in">

                {/* Sprint 1 Sub-spec B Task 3 — canonical PageHeader.
                    Meta is wired to dashboardMeta Alpine data (see dashboard.js)
                    so counts update live as buckets load. */}
                <div x-data="dashboardMeta">
                    <PageHeader
                        eyebrow="DASHBOARD"
                        eyebrowColor="indigo"
                        title="Inspections"
                        meta={
                            <span x-text="metaText"></span>
                        }
                        actions={
                            <>
                                {/* Round-2 backlog #2 — Customize Columns toolbar button.
                                    Opens the modal whose Alpine state is on the modal root.
                                    Sits to the LEFT of New Inspection so the primary CTA
                                    keeps its position; styled as a low-emphasis icon button. */}
                                <button
                                    type="button"
                                    onclick="document.getElementById('customizeColumnsModal')?.classList.remove('hidden')"
                                    class="h-8 px-3 rounded-md border bg-white text-slate-600 font-bold text-[13px] hover:bg-slate-50 active:scale-95 transition-all inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                                    style="border-color: #e2e8f0"
                                    aria-label="Customize columns"
                                    title="Customize columns"
                                    data-test="customize-columns-btn"
                                >
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                                    </svg>
                                    Columns
                                </button>
                                <button
                                    type="button"
                                    onclick="showCreateModal()"
                                    class="h-8 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 active:scale-95 transition-all inline-flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                                >
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                                    </svg>
                                    New Inspection
                                </button>
                            </>
                        }
                    />
                </div>

                {/* Statistics Grid — R7-04 fix: each card is now a button
                    that opens the matching bucket section + scrolls into
                    view. anchor maps to a section in the inspections list
                    rendered below.
                    Sub-spec B Task 5 (B-4) — each card now also renders portfolio
                    defectStats chips beneath the count when the bucket has any
                    open defects. The Alpine binding is local: `dashboardCards`
                    factory pulls defectAggregate from /api/inspections/dashboard. */}
                <div x-data="dashboardCards" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                        { label: 'Upcoming',        id: 'statUpcoming',   target: 'later',          icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', color: 'indigo' },
                        { label: 'In Progress',     id: 'statInProgress', target: 'thisWeek',       icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z', color: 'blue' },
                        { label: 'Needs Attention', id: 'statNeedsAttn',  target: 'needsAttention', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z', color: 'amber' },
                        { label: 'Recent Reports',  id: 'statRecentRpt',  target: 'recentReports',  icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', color: 'emerald' }
                    ].map((stat, i) => (
                        <button
                            key={stat.id}
                            type="button"
                            x-on:click={`sections['${stat.target}']=true; $nextTick(()=>{ const el=document.getElementById('bucket-${stat.target}'); if(el) el.scrollIntoView({behavior:'smooth', block:'start'}); })`}
                            class="group p-4 rounded-lg bg-white border border-slate-200 animate-fade-in text-left hover:shadow-md hover:border-slate-300 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                            style={`animation-delay: ${0.1 + i * 0.05}s`}
                            title={`Jump to ${stat.label}`}
                        >
                            <div class="flex items-center justify-between mb-4">
                                <div class={`w-10 h-10 rounded-md bg-${stat.color}-600/10 text-${stat.color}-600 flex items-center justify-center group-hover:scale-105 transition-all duration-200`}>
                                   <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={stat.icon}></path></svg>
                                </div>
                                <span class="sr-only">Live</span>
                            </div>
                            <h3 class="text-2xl font-bold text-slate-900 tracking-tight tabular-nums mb-1" id={stat.id}>0</h3>
                            <p class="text-[12px] font-bold text-slate-500 uppercase tracking-[0.15em]">{stat.label}</p>
                            {/* Portfolio defect chips — only when bucket has at least one defect.
                                ih-pill canonical class lives in input.css. */}
                            <div class="mt-3 flex items-center gap-1 flex-wrap" x-show={`agg('${stat.target}').safety + agg('${stat.target}').recommendation + agg('${stat.target}').maintenance > 0`}>
                                <span x-show={`agg('${stat.target}').safety > 0`} class="ih-pill ih-pill--defect" title="Safety defects" x-text={`'\u{1F534} ' + agg('${stat.target}').safety`}></span>
                                <span x-show={`agg('${stat.target}').recommendation > 0`} class="ih-pill ih-pill--monitor" title="Recommendations" x-text={`'\u{1F7E1} ' + agg('${stat.target}').recommendation`}></span>
                                <span x-show={`agg('${stat.target}').maintenance > 0`} class="ih-pill ih-pill--info" title="Maintenance items" x-text={`'\u{1F535} ' + agg('${stat.target}').maintenance`}></span>
                            </div>
                        </button>
                    ))}
                </div>

                {/* Earnings Panel — only visible when there's revenue activity */}
                <div x-data="dashboardEarnings()" x-init="loadEarnings()" x-show="earnings.paid > 0 || earnings.pending > 0" class="bg-white rounded-md shadow-sm border border-slate-100 p-6 grid grid-cols-1 md:grid-cols-3 gap-4 mb-6" style="display: none;">
                    <div>
                        <div class="text-[10px] font-bold uppercase tracking-widest text-slate-400">Paid this period</div>
                        <div class="mt-1 text-xl font-bold text-emerald-600" x-text="formatCurrency(earnings.paid)"></div>
                    </div>
                    <div>
                        <div class="text-[10px] font-bold uppercase tracking-widest text-slate-400">Pending</div>
                        <div class="mt-1 text-xl font-bold text-amber-600" x-text="formatCurrency(earnings.pending)"></div>
                    </div>
                    <div>
                        <div class="text-[10px] font-bold uppercase tracking-widest text-slate-400">Paid invoices</div>
                        <div class="mt-1 text-xl font-bold text-slate-900" x-text="earnings.count"></div>
                    </div>
                </div>

                {/* Collapsible Inspection Sections */}
                <div x-data="dashboard()" x-init="init()" class="space-y-4 mt-8">

                    {/* Spec 4E — offline cache progress pill */}
                    <div x-show="cacheProgress" {...{ 'x-cloak': true }} class="text-xs text-slate-500 inline-flex items-center gap-1.5 px-2 py-1 bg-slate-100 rounded-full">
                        <span class="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                        <span x-text="cacheProgress"></span>
                    </div>

                    {/* Loading spinner */}
                    <div x-show="loading" class="flex items-center justify-center py-10">
                        <div class="relative w-12 h-12">
                            <div class="absolute inset-0 border-4 border-indigo-50 rounded-full"></div>
                            <div class="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                        </div>
                    </div>

                    {/*
                      Competitor parity Feature C1 — time-based filter tabs.
                      Renders ALL / PAST / YESTERDAY / TODAY / TOMORROW /
                      THIS WEEK / FUTURE / UNCONFIRMED / IN PROGRESS as a
                      horizontal pill strip. ALL keeps the existing grouped
                      bucket layout below. Any other filter swaps to a flat
                      list filtered in-memory by `matchesInspectionFilter`.
                      Counts (e.g. "TODAY (3)") render only when > 0.
                    */}
                    <div
                        x-show="!loading && !allBucketsEmpty"
                        {...{ 'x-cloak': true }}
                        role="tablist"
                        aria-label="Inspection time filter"
                        class="flex flex-wrap items-center gap-1.5 -mt-1"
                        data-test="inspection-filter-tabs"
                    >
                        <template x-for="opt in filterOptions" {...{ 'x-bind:key': 'opt.id' }}>
                            <button
                                type="button"
                                role="tab"
                                x-bind:aria-selected="activeFilter === opt.id ? 'true' : 'false'"
                                x-bind:data-active={`activeFilter === opt.id ? '1' : '0'`}
                                x-on:click="setFilter(opt.id)"
                                x-bind:class={`activeFilter === opt.id
                                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-900'`}
                                class="inline-flex items-center gap-1.5 h-7 px-3 rounded-full border text-[11px] font-bold uppercase tracking-[0.08em] transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                            >
                                <span x-text="opt.label"></span>
                                <span
                                    x-show="opt.id !== 'all' && filterCounts[opt.id] > 0"
                                    x-bind:class={`activeFilter === opt.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'`}
                                    class="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] tabular-nums"
                                    x-text="filterCounts[opt.id]"
                                ></span>
                            </button>
                        </template>
                    </div>

                    {/* C1 — Flat filtered list, shown only when activeFilter !== 'all'. */}
                    <section
                        x-show="!loading && activeFilter !== 'all'"
                        {...{ 'x-cloak': true }}
                        class="bg-white border border-slate-200 rounded-md scroll-mt-20"
                        data-test="inspection-filter-list"
                    >
                        <div class="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                            <div class="flex items-center gap-2">
                                <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Filtered</span>
                                <span class="text-[12px] font-bold text-slate-700" x-text="filteredInspections.length + ' result' + (filteredInspections.length === 1 ? '' : 's')"></span>
                            </div>
                            <button type="button" x-on:click="setFilter('all')" class="text-[11px] font-bold text-indigo-600 hover:text-indigo-700">Clear</button>
                        </div>
                        <div x-show="filteredInspections.length === 0" class="px-5 py-6 text-center text-[12px] text-slate-400">
                            No inspections match this filter.
                        </div>
                        <template x-for="i in filteredInspections" {...{ 'x-bind:key': 'i.id' }}>
                            <div class="px-5 py-3 border-t border-slate-100 flex items-center gap-3" data-test="inspection-row">
                                <a x-bind:href="'/inspections/' + i.id + '/edit'" class="flex-1 min-w-0">
                                    <p class="font-bold text-slate-900 truncate text-[14px]" x-text="i.propertyAddress || i.address || '(no address)'"></p>
                                    <p class="text-[12px] text-slate-500 mt-0.5">
                                        <span x-text="i.clientName || '—'"></span>
                                        <template x-if="i.agentName"><span> · <span class="text-slate-400">via</span> <span x-text="i.agentName"></span></span></template>
                                        <span> · </span>
                                        <span x-text="i.date ? new Date(i.date).toLocaleString() : 'no date'"></span>
                                        <span> · </span>
                                        <span class="uppercase tracking-wide text-[10px] font-bold text-slate-400" x-text="(i.status || '').replace('_', ' ')"></span>
                                    </p>
                                </a>
                                <div x-show="i.price > 0" class="text-[13px] font-mono font-semibold text-slate-700 tabular-nums" x-text="'$' + ((i.price || 0) / 100).toFixed(0)"></div>
                            </div>
                        </template>
                    </section>

                    {/* Section: Needs Attention */}
                    <section id="bucket-needsAttention" x-show="!loading && activeFilter === 'all' && buckets.needsAttention.length > 0" {...{ 'x-cloak': true }} class="bg-white border border-slate-200 rounded-md scroll-mt-20">
                        <button type="button" x-on:click="sections.needsAttention = !sections.needsAttention"
                                class="w-full flex items-center justify-between px-5 py-4 text-left">
                            <div class="flex items-center gap-3">
                                <span class="text-amber-600">&#9888;</span>
                                <span class="font-bold text-slate-900">Needs attention</span>
                                <span class="text-xs font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5" x-text="buckets.needsAttention.length"></span>
                            </div>
                            <span x-text="sections.needsAttention ? '−' : '+'" class="text-slate-400 text-xl"></span>
                        </button>
                        <div x-show="sections.needsAttention" {...{ 'x-collapse': true }}>
                            <template x-for="i in buckets.needsAttention" {...{ 'x-bind:key': 'i.id' }}>
                                <InspectionRow />
                            </template>
                        </div>
                    </section>

                    {/* Section: Today */}
                    <section id="bucket-today" x-show="!loading && activeFilter === 'all' && buckets.today.length > 0" {...{ 'x-cloak': true }} class="bg-white border border-slate-200 rounded-md scroll-mt-20">
                        <button type="button" x-on:click="sections.today = !sections.today"
                                class="w-full flex items-center justify-between px-5 py-4 text-left">
                            <div class="flex items-center gap-3">
                                <span class="text-blue-600">&#128197;</span>
                                <span class="font-bold text-slate-900">Today</span>
                                <span class="text-xs font-bold text-blue-700 bg-blue-100 rounded-full px-2 py-0.5" x-text="buckets.today.length"></span>
                            </div>
                            <span x-text="sections.today ? '−' : '+'" class="text-slate-400 text-xl"></span>
                        </button>
                        <div x-show="sections.today" {...{ 'x-collapse': true }}>
                            <template x-for="i in buckets.today" {...{ 'x-bind:key': 'i.id' }}>
                                <InspectionRow />
                            </template>
                        </div>
                    </section>

                    {/* Section: Today's events (Spec 4D.T10) */}
                    <section x-show="!loading && activeFilter === 'all' && todayEvents.length > 0" {...{ 'x-cloak': true }} class="bg-white border border-slate-200 rounded-md">
                        <button type="button" x-on:click="sections.todayEvents = !sections.todayEvents"
                                class="w-full flex items-center justify-between px-5 py-4 text-left">
                            <div class="flex items-center gap-3">
                                <span class="text-purple-600">&#128203;</span>
                                <span class="font-bold text-slate-900">Today's events</span>
                                <span class="text-xs font-bold text-purple-700 bg-purple-100 rounded-full px-2 py-0.5" x-text="todayEvents.length"></span>
                            </div>
                            <span x-text="sections.todayEvents ? '−' : '+'" class="text-slate-400 text-xl"></span>
                        </button>
                        <div x-show="sections.todayEvents" {...{ 'x-collapse': true }}>
                            <template x-for="e in todayEvents" {...{ 'x-bind:key': 'e.id' }}>
                                <div class="px-5 py-3 border-t border-slate-100 flex items-center gap-3 text-sm">
                                    <span class="font-mono text-xs text-slate-500" x-text="new Date(e.scheduledAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})"></span>
                                    <span class="font-bold text-slate-900" x-text="eventTypeName(e.eventTypeId)"></span>
                                    <span class="text-slate-400 text-xs" x-show="e.durationMin" x-text="(e.durationMin || 0) + ' min'"></span>
                                    <a x-bind:href="'/inspections/' + e.inspectionId + '/edit'" class="ml-auto text-indigo-600 text-xs font-bold hover:underline">Open</a>
                                </div>
                            </template>
                        </div>
                    </section>

                    {/* Section: This Week */}
                    <section id="bucket-thisWeek" x-show="!loading && activeFilter === 'all' && buckets.thisWeek.length > 0" {...{ 'x-cloak': true }} class="bg-white border border-slate-200 rounded-md scroll-mt-20">
                        <button type="button" x-on:click="sections.thisWeek = !sections.thisWeek"
                                class="w-full flex items-center justify-between px-5 py-4 text-left">
                            <div class="flex items-center gap-3">
                                <span class="text-slate-500">&#128197;</span>
                                <span class="font-bold text-slate-900">This week</span>
                                <span class="text-xs font-bold text-slate-700 bg-slate-100 rounded-full px-2 py-0.5" x-text="buckets.thisWeek.length"></span>
                            </div>
                            <span x-text="sections.thisWeek ? '−' : '+'" class="text-slate-400 text-xl"></span>
                        </button>
                        <div x-show="sections.thisWeek" {...{ 'x-collapse': true }}>
                            <template x-for="i in buckets.thisWeek" {...{ 'x-bind:key': 'i.id' }}>
                                <InspectionRow />
                            </template>
                        </div>
                    </section>

                    {/* Section: Later */}
                    <section x-show="!loading && activeFilter === 'all' && (buckets.later.length > 0 || buckets.laterTotal > 0)" {...{ 'x-cloak': true }} class="bg-white border border-slate-200 rounded-md">
                        <button type="button" x-on:click="sections.later = !sections.later"
                                class="w-full flex items-center justify-between px-5 py-4 text-left">
                            <div class="flex items-center gap-3">
                                <span class="text-slate-500">&#128197;</span>
                                <span class="font-bold text-slate-900">Later</span>
                                <span class="text-xs font-bold text-slate-700 bg-slate-100 rounded-full px-2 py-0.5" x-text="buckets.laterTotal || buckets.later.length"></span>
                            </div>
                            <span x-text="sections.later ? '−' : '+'" class="text-slate-400 text-xl"></span>
                        </button>
                        <div x-show="sections.later" {...{ 'x-collapse': true }}>
                            <template x-for="i in buckets.later" {...{ 'x-bind:key': 'i.id' }}>
                                <InspectionRow />
                            </template>
                            <div x-show="buckets.laterTotal > buckets.later.length" class="px-5 py-3 border-t border-slate-100">
                                <button type="button" x-on:click="loadAllLater()"
                                        class="text-sm text-indigo-600 font-semibold hover:text-indigo-800 transition-colors"
                                        x-text="'Show all (' + buckets.later.length + ' of ' + buckets.laterTotal + ')'"></button>
                            </div>
                        </div>
                    </section>

                    {/* Section: Recent Reports */}
                    <section id="bucket-recentReports" x-show="!loading && activeFilter === 'all' && buckets.recentReports.length > 0" {...{ 'x-cloak': true }} class="bg-white border border-slate-200 rounded-md scroll-mt-20">
                        <button type="button" x-on:click="sections.recentReports = !sections.recentReports"
                                class="w-full flex items-center justify-between px-5 py-4 text-left">
                            <div class="flex items-center gap-3">
                                <span class="text-emerald-600">&#10003;</span>
                                <span class="font-bold text-slate-900">Recent reports</span>
                                <span class="text-xs font-bold text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5" x-text="buckets.recentReports.length"></span>
                            </div>
                            <span x-text="sections.recentReports ? '−' : '+'" class="text-slate-400 text-xl"></span>
                        </button>
                        <div x-show="sections.recentReports" {...{ 'x-collapse': true }}>
                            <template x-for="i in buckets.recentReports" {...{ 'x-bind:key': 'i.id' }}>
                                <InspectionRow />
                            </template>
                        </div>
                    </section>

                    {/* Section: Cancelled */}
                    <section x-show="!loading && activeFilter === 'all' && buckets.cancelled.length > 0" {...{ 'x-cloak': true }} class="bg-white border border-slate-200 rounded-md">
                        <button type="button" x-on:click="sections.cancelled = !sections.cancelled"
                                class="w-full flex items-center justify-between px-5 py-4 text-left">
                            <div class="flex items-center gap-3">
                                <span class="text-rose-600">&#128683;</span>
                                <span class="font-bold text-slate-900">Cancelled</span>
                                <span class="text-xs font-bold text-rose-700 bg-rose-100 rounded-full px-2 py-0.5" x-text="buckets.cancelled.length"></span>
                            </div>
                            <span x-text="sections.cancelled ? '−' : '+'" class="text-slate-400 text-xl"></span>
                        </button>
                        <div x-show="sections.cancelled" {...{ 'x-collapse': true }}>
                            <template x-for="i in buckets.cancelled" {...{ 'x-bind:key': 'i.id' }}>
                                <InspectionRow />
                            </template>
                        </div>
                    </section>

                    {/* Empty state */}
                    <div x-show="!loading && allBucketsEmpty" {...{ 'x-cloak': true }} class="text-center py-10 text-slate-400">
                        <div class="w-20 h-20 rounded-lg bg-indigo-50 flex items-center justify-center mx-auto mb-4">
                            <svg class="w-10 h-10 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                        </div>
                        <p class="text-sm">No inspections yet. Create one above to get started.</p>
                    </div>

                    <CancelModal />
                </div>

                {/* Round-2 backlog #2 — Customize Columns modal (sibling of the
                    dashboard() Alpine root so the modal opens above the list
                    but the dashboard() factory's `isVisible(id)` reactive
                    helper is shared via `window.__dashboardColumns`). */}
                <CustomizeColumnsModal />

                {/* Create Inspection Modal — R7-11 fix: add overflow-x-hidden so
                    in-modal vertical scroll doesn't spill into page-level
                    horizontal scroll on narrow viewports.
                    R39 — canonical h-10 button row (asymmetric flex-1 / flex-[2]
                    Create Inspection variant kept; footer inlined). */}
                <Modal
                    id="createModal"
                    title="New Inspection"
                    subtitle="Enter the details for this inspection."
                    size="2xl"
                    footer={
                        <>
                            <button
                                type="button"
                                onclick="closeModal()"
                                class="flex-1 h-10 px-4 rounded-xl border bg-white text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-all"
                                style="border-color: #e2e8f0"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onclick="submitInspection()"
                                id="submitInsBtn"
                                class="flex-[2] h-10 px-4 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all active:scale-95"
                            >
                                Create Inspection
                            </button>
                        </>
                    }
                >
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-2">
                                <div class="space-y-2 md:col-span-2 relative">
                                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] ml-1">Property Address</label>
                                    <input type="text" id="propAddress" placeholder="Start typing — autocomplete via Google" autocomplete="off" data-places-autocomplete
                                        class="premium-input w-full px-3 py-2 rounded-md border-2 border-slate-50 focus:border-emerald-600 outline-none transition-all font-bold text-sm" />
                                    {/* Spec 5D — Google Places autocomplete dropdown.
                                        Hidden until at least 2 chars typed. Falls back to
                                        plain text input when GOOGLE_PLACES_API_KEY absent. */}
                                    <div id="propAddressDropdown" class="hidden absolute left-0 right-0 top-full z-50 mt-1 bg-white border border-slate-200 rounded-md shadow-2xl max-h-72 overflow-y-auto"></div>
                                    <input type="hidden" id="propPlaceId" />
                                    <input type="hidden" id="propAddrStreet" />
                                    <input type="hidden" id="propAddrCity" />
                                    <input type="hidden" id="propAddrState" />
                                    <input type="hidden" id="propAddrZip" />
                                    <input type="hidden" id="propAddrCounty" />
                                    <input type="hidden" id="propLat" />
                                    <input type="hidden" id="propLng" />
                                </div>
                                <div class="space-y-2">
                                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] ml-1">Template</label>
                                    <select id="templateId" class="premium-input w-full px-3 py-2 rounded-md border-2 border-slate-50 focus:border-emerald-600 outline-none transition-all font-bold text-sm bg-white">
                                        <option value="">Select a template...</option>
                                    </select>
                                    <p id="noTemplateHint" class="hidden text-xs text-amber-600 font-semibold mt-1 ml-1">
                                        No templates found. <a href="/templates" class="underline hover:text-amber-800">Create a template</a> first.
                                    </p>
                                </div>
                                <div class="space-y-2">
                                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] ml-1">Inspection Date &amp; Time</label>
                                    <input type="text" id="inspectionDate" data-flatpickr data-min-date="today" autocomplete="off" placeholder="Pick date and time"
                                        class="premium-input w-full px-3 py-2 rounded-md border-2 border-slate-50 focus:border-emerald-600 outline-none transition-all font-bold text-sm" />
                                </div>
                                <div x-data="contactSelector" class="relative mb-3">
                                    {/* R7-08 fix: clarify that this autocompletes existing contacts
                                        and auto-fills Name/Email/Phone below. Without this hint,
                                        users wonder whether to type here OR fill the fields below. */}
                                    <label class="block text-xs font-bold text-slate-600 mb-1">Client</label>
                                    <p class="text-[10px] text-slate-400 mb-2 leading-tight">Search a saved contact (auto-fills Name / Email / Phone), or skip to type a new one below.</p>
                                    <input
                                        type="text"
                                        x-model="searchText"
                                        x-on:input="onInput()"
                                        x-on:focus="showDropdown = searchText.length > 0"
                                        placeholder="Search saved contacts…"
                                        class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
                                        autocomplete="off"
                                    />
                                    <div x-show="showDropdown && (results.length > 0 || searchText.trim().length > 0)" x-cloak class="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                                        <template x-for="c in results" {...{ 'x-bind:key': 'c.id' }}>
                                            <button type="button" x-on:click="selectContact(c)" class="w-full px-3 py-2 text-left hover:bg-indigo-50 text-sm">
                                                <div class="font-semibold" x-text="c.name"></div>
                                                <div class="text-xs text-slate-500" x-text="(c.email || '') + (c.agency ? ' · ' + c.agency : '')"></div>
                                            </button>
                                        </template>
                                        <button type="button" x-show="searchText.trim().length > 0 && !results.some(r => r.name.toLowerCase() === searchText.trim().toLowerCase())" x-on:click="createNew()" {...{ 'x-bind:disabled': 'creating' }} class="w-full px-3 py-2 text-left bg-indigo-50 hover:bg-indigo-100 text-sm border-t border-slate-100">
                                            <span x-text="`+ Create '${searchText.trim()}' as new contact`" class="font-semibold text-indigo-700"></span>
                                        </button>
                                    </div>
                                </div>
                                <div class="space-y-2">
                                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] ml-1">Client Name</label>
                                    <input type="text" id="clientName" placeholder="e.g., John Doe"
                                        class="premium-input w-full px-3 py-2 rounded-md border-2 border-slate-50 focus:border-emerald-600 outline-none transition-all font-bold text-sm" />
                                </div>
                                <div class="space-y-2">
                                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] ml-1">Client Email</label>
                                    <input type="email" id="clientEmail" placeholder="e.g., john@example.com"
                                        class="premium-input w-full px-3 py-2 rounded-md border-2 border-slate-50 focus:border-emerald-600 outline-none transition-all font-bold text-sm" />
                                </div>
                                <div class="space-y-2">
                                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] ml-1">Client Phone</label>
                                    <input type="tel" id="clientPhone" placeholder="e.g., (555) 123-4567"
                                        class="premium-input w-full px-3 py-2 rounded-md border-2 border-slate-50 focus:border-emerald-600 outline-none transition-all font-bold text-sm" />
                                </div>
                                <div class="space-y-2">
                                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] ml-1">Assign Inspector</label>
                                    <select id="inspectorId" class="premium-input w-full px-3 py-2 rounded-md border-2 border-slate-50 focus:border-emerald-600 outline-none transition-all font-bold text-sm bg-white">
                                        <option value="">Self-assignment</option>
                                    </select>
                                </div>
                                <div class="space-y-2">
                                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] ml-1">Listing Agent</label>
                                    <select id="agentId" class="premium-input w-full px-3 py-2 rounded-md border-2 border-slate-50 focus:border-emerald-600 outline-none transition-all font-bold text-sm bg-white">
                                        <option value="">None</option>
                                    </select>
                                </div>
                                {/* R7-09: Buyer's Agent — separate field from Listing Agent so
                                    inspectors can record both sides of the transaction. Maps to
                                    inspections.sellingAgentId. Both selects share populateAgents(). */}
                                <div class="space-y-2">
                                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] ml-1">Buyer's Agent</label>
                                    <select id="buyerAgentId" class="premium-input w-full px-3 py-2 rounded-md border-2 border-slate-50 focus:border-emerald-600 outline-none transition-all font-bold text-sm bg-white">
                                        <option value="">None</option>
                                    </select>
                                </div>
                            </div>

                            {/* Services selection */}
                            <div id="servicesSection" style="display:none" class="mb-4">
                                <div class="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-3">Services</div>
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
                                            <div id="serviceTotalAmount" class="text-lg font-bold">$0.00</div>
                                            <div id="serviceDiscountLine" style="display:none" class="text-xs text-green-400"></div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                </Modal>

                <script src="/js/modal-dialog.js"></script>
                <script src="/js/auth.js"></script>
                <script src="/js/action-menu.js"></script>
                <script src="/js/dashboard.js"></script>
                <script type="module" src="/js/contact-selector.js"></script>
                <script type="module" src="/js/dashboard-prefetch.js"></script>
            </div>
        </MainLayout>
    );
};
