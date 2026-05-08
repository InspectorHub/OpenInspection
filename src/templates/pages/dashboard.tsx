import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';
import { CancelModal } from '../components/cancel-modal';
import { Modal } from '../components/modal';
import { PageHeader } from '../components/page-header';

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

                    {/* Section: Needs Attention */}
                    <section id="bucket-needsAttention" x-show="!loading && buckets.needsAttention.length > 0" {...{ 'x-cloak': true }} class="bg-white border border-slate-200 rounded-md scroll-mt-20">
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
                                <div class="px-5 py-3 border-t border-slate-100 flex items-center gap-3" data-test="inspection-row">
                                    <a x-bind:href="'/inspections/' + i.id + '/edit'" class="flex-1 min-w-0">
                                        <p class="font-bold text-slate-900 truncate text-[14px]" x-text="i.propertyAddress || i.address || '(no address)'"></p>
                                        <p class="text-[12px] text-slate-500 mt-0.5">
                                            <span x-text="i.clientName || '—'"></span>
                                            <template x-if="i.agentName"><span> · <span class="text-slate-400">via</span> <span x-text="i.agentName"></span></span></template>
                                            {/* Sprint 2 S2-2 — sibling-count badge for multi-inspection requests. */}
                                            <template x-if="i.siblingCount && i.siblingCount > 1">
                                                <span> · <span class="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold ring-1 ring-inset ring-indigo-200" x-text="i.siblingCount + ' inspections'"></span></span>
                                            </template>
                                            <span> · </span>
                                            <span x-text="i.date ? new Date(i.date).toLocaleString() : 'no date'"></span>
                                        </p>
                                        {/* Spec 5B P2B — defect chips per inspection. Hidden when all zero. */}
                                        <div class="mt-1 flex items-center gap-1.5" x-show="i.defectStats && (i.defectStats.safety + i.defectStats.recommendation + i.defectStats.maintenance) > 0">
                                            <span x-show="i.defectStats?.safety > 0" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-50 text-rose-700" x-text="'🔴 ' + i.defectStats.safety + ' safety'"></span>
                                            <span x-show="i.defectStats?.recommendation > 0" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-50 text-amber-700" x-text="'🟡 ' + i.defectStats.recommendation + ' rec'"></span>
                                            <span x-show="i.defectStats?.maintenance > 0" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-sky-50 text-sky-700" x-text="'🔵 ' + i.defectStats.maintenance + ' maint'"></span>
                                        </div>
                                    </a>
                                    {/* Sub-spec B Task 7 (B-6) — price (right-aligned, monospace) */}
                                    <div x-show="i.price > 0" class="text-[13px] font-mono font-semibold text-slate-700 tabular-nums" x-text="'$' + ((i.price || 0) / 100).toFixed(0)"></div>
                                    {/* Status icons — slate-300 default, semantic color when active */}
                                    <div class="flex items-center gap-1 text-slate-300">
                                        <span class="w-5 h-5 inline-flex items-center justify-center" x-bind:class="i.statusFlags?.reportPublished ? 'text-emerald-500' : ''" x-bind:title="i.statusFlags?.reportPublished ? 'Report published' : 'Report not yet published'" x-bind:aria-label="i.statusFlags?.reportPublished ? 'Report published' : 'Report not yet published'">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/><path fill-rule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd"/></svg>
                                        </span>
                                        <span class="w-5 h-5 inline-flex items-center justify-center" x-bind:class="i.statusFlags?.agreementSigned ? 'text-emerald-500' : ''" x-bind:title="i.statusFlags?.agreementSigned ? 'Agreement signed' : 'Agreement not yet signed'" x-bind:aria-label="i.statusFlags?.agreementSigned ? 'Agreement signed' : 'Agreement not yet signed'">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
                                        </span>
                                        <span class="w-5 h-5 inline-flex items-center justify-center" x-bind:class="i.statusFlags?.paid ? 'text-emerald-500' : (i.price > 0 ? 'text-amber-500' : '')" x-bind:title="i.statusFlags?.paid ? 'Paid' : (i.price > 0 ? 'Payment pending' : 'No payment required')" x-bind:aria-label="i.statusFlags?.paid ? 'Paid' : (i.price > 0 ? 'Payment pending' : 'No payment required')">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm12 4a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4a2 2 0 012-2h10zm-7 5a2 2 0 100-4 2 2 0 000 4z"/></svg>
                                        </span>
                                        <span x-show="i.statusFlags?.flagged" class="w-5 h-5 inline-flex items-center justify-center text-rose-500" title="Flagged: invoice overdue or other attention needed" aria-label="Flagged">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z" clip-rule="evenodd"/></svg>
                                        </span>
                                    </div>
                                    <div x-data="actionMenu({ id: i.id, status: i.status })" class="relative ml-3">
                                        <button type="button" x-on:click="open = !open" class="text-slate-400 hover:text-slate-700 px-2 text-lg font-bold">•••</button>
                                        <div x-show="open" {...{ 'x-cloak': true, 'x-on:click.outside': 'open = false' }} class="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 min-w-[140px]">
                                            <template x-for="a in validActions()" {...{ 'x-bind:key': 'a' }}>
                                                <button type="button" x-on:click="run(a)" class="block w-full text-left px-4 py-2 text-sm hover:bg-slate-50" x-text="actionLabel(a)"></button>
                                            </template>
                                        </div>
                                    </div>
                                </div>
                            </template>
                        </div>
                    </section>

                    {/* Section: Today */}
                    <section id="bucket-today" x-show="!loading && buckets.today.length > 0" {...{ 'x-cloak': true }} class="bg-white border border-slate-200 rounded-md scroll-mt-20">
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
                                <div class="px-5 py-3 border-t border-slate-100 flex items-center gap-3" data-test="inspection-row">
                                    <a x-bind:href="'/inspections/' + i.id + '/edit'" class="flex-1 min-w-0">
                                        <p class="font-bold text-slate-900 truncate text-[14px]" x-text="i.propertyAddress || i.address || '(no address)'"></p>
                                        <p class="text-[12px] text-slate-500 mt-0.5">
                                            <span x-text="i.clientName || '—'"></span>
                                            <template x-if="i.agentName"><span> · <span class="text-slate-400">via</span> <span x-text="i.agentName"></span></span></template>
                                            {/* Sprint 2 S2-2 — sibling-count badge for multi-inspection requests. */}
                                            <template x-if="i.siblingCount && i.siblingCount > 1">
                                                <span> · <span class="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold ring-1 ring-inset ring-indigo-200" x-text="i.siblingCount + ' inspections'"></span></span>
                                            </template>
                                            <span> · </span>
                                            <span x-text="i.date ? new Date(i.date).toLocaleString() : 'no date'"></span>
                                        </p>
                                        {/* Spec 5B P2B — defect chips per inspection. Hidden when all zero. */}
                                        <div class="mt-1 flex items-center gap-1.5" x-show="i.defectStats && (i.defectStats.safety + i.defectStats.recommendation + i.defectStats.maintenance) > 0">
                                            <span x-show="i.defectStats?.safety > 0" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-50 text-rose-700" x-text="'🔴 ' + i.defectStats.safety + ' safety'"></span>
                                            <span x-show="i.defectStats?.recommendation > 0" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-50 text-amber-700" x-text="'🟡 ' + i.defectStats.recommendation + ' rec'"></span>
                                            <span x-show="i.defectStats?.maintenance > 0" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-sky-50 text-sky-700" x-text="'🔵 ' + i.defectStats.maintenance + ' maint'"></span>
                                        </div>
                                    </a>
                                    {/* Sub-spec B Task 7 (B-6) — price (right-aligned, monospace) */}
                                    <div x-show="i.price > 0" class="text-[13px] font-mono font-semibold text-slate-700 tabular-nums" x-text="'$' + ((i.price || 0) / 100).toFixed(0)"></div>
                                    {/* Status icons — slate-300 default, semantic color when active */}
                                    <div class="flex items-center gap-1 text-slate-300">
                                        <span class="w-5 h-5 inline-flex items-center justify-center" x-bind:class="i.statusFlags?.reportPublished ? 'text-emerald-500' : ''" x-bind:title="i.statusFlags?.reportPublished ? 'Report published' : 'Report not yet published'" x-bind:aria-label="i.statusFlags?.reportPublished ? 'Report published' : 'Report not yet published'">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/><path fill-rule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd"/></svg>
                                        </span>
                                        <span class="w-5 h-5 inline-flex items-center justify-center" x-bind:class="i.statusFlags?.agreementSigned ? 'text-emerald-500' : ''" x-bind:title="i.statusFlags?.agreementSigned ? 'Agreement signed' : 'Agreement not yet signed'" x-bind:aria-label="i.statusFlags?.agreementSigned ? 'Agreement signed' : 'Agreement not yet signed'">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
                                        </span>
                                        <span class="w-5 h-5 inline-flex items-center justify-center" x-bind:class="i.statusFlags?.paid ? 'text-emerald-500' : (i.price > 0 ? 'text-amber-500' : '')" x-bind:title="i.statusFlags?.paid ? 'Paid' : (i.price > 0 ? 'Payment pending' : 'No payment required')" x-bind:aria-label="i.statusFlags?.paid ? 'Paid' : (i.price > 0 ? 'Payment pending' : 'No payment required')">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm12 4a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4a2 2 0 012-2h10zm-7 5a2 2 0 100-4 2 2 0 000 4z"/></svg>
                                        </span>
                                        <span x-show="i.statusFlags?.flagged" class="w-5 h-5 inline-flex items-center justify-center text-rose-500" title="Flagged: invoice overdue or other attention needed" aria-label="Flagged">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z" clip-rule="evenodd"/></svg>
                                        </span>
                                    </div>
                                    <div x-data="actionMenu({ id: i.id, status: i.status })" class="relative ml-3">
                                        <button type="button" x-on:click="open = !open" class="text-slate-400 hover:text-slate-700 px-2 text-lg font-bold">•••</button>
                                        <div x-show="open" {...{ 'x-cloak': true, 'x-on:click.outside': 'open = false' }} class="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 min-w-[140px]">
                                            <template x-for="a in validActions()" {...{ 'x-bind:key': 'a' }}>
                                                <button type="button" x-on:click="run(a)" class="block w-full text-left px-4 py-2 text-sm hover:bg-slate-50" x-text="actionLabel(a)"></button>
                                            </template>
                                        </div>
                                    </div>
                                </div>
                            </template>
                        </div>
                    </section>

                    {/* Section: Today's events (Spec 4D.T10) */}
                    <section x-show="!loading && todayEvents.length > 0" {...{ 'x-cloak': true }} class="bg-white border border-slate-200 rounded-md">
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
                    <section id="bucket-thisWeek" x-show="!loading && buckets.thisWeek.length > 0" {...{ 'x-cloak': true }} class="bg-white border border-slate-200 rounded-md scroll-mt-20">
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
                                <div class="px-5 py-3 border-t border-slate-100 flex items-center gap-3" data-test="inspection-row">
                                    <a x-bind:href="'/inspections/' + i.id + '/edit'" class="flex-1 min-w-0">
                                        <p class="font-bold text-slate-900 truncate text-[14px]" x-text="i.propertyAddress || i.address || '(no address)'"></p>
                                        <p class="text-[12px] text-slate-500 mt-0.5">
                                            <span x-text="i.clientName || '—'"></span>
                                            <template x-if="i.agentName"><span> · <span class="text-slate-400">via</span> <span x-text="i.agentName"></span></span></template>
                                            {/* Sprint 2 S2-2 — sibling-count badge for multi-inspection requests. */}
                                            <template x-if="i.siblingCount && i.siblingCount > 1">
                                                <span> · <span class="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold ring-1 ring-inset ring-indigo-200" x-text="i.siblingCount + ' inspections'"></span></span>
                                            </template>
                                            <span> · </span>
                                            <span x-text="i.date ? new Date(i.date).toLocaleString() : 'no date'"></span>
                                        </p>
                                        {/* Spec 5B P2B — defect chips per inspection. Hidden when all zero. */}
                                        <div class="mt-1 flex items-center gap-1.5" x-show="i.defectStats && (i.defectStats.safety + i.defectStats.recommendation + i.defectStats.maintenance) > 0">
                                            <span x-show="i.defectStats?.safety > 0" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-50 text-rose-700" x-text="'🔴 ' + i.defectStats.safety + ' safety'"></span>
                                            <span x-show="i.defectStats?.recommendation > 0" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-50 text-amber-700" x-text="'🟡 ' + i.defectStats.recommendation + ' rec'"></span>
                                            <span x-show="i.defectStats?.maintenance > 0" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-sky-50 text-sky-700" x-text="'🔵 ' + i.defectStats.maintenance + ' maint'"></span>
                                        </div>
                                    </a>
                                    {/* Sub-spec B Task 7 (B-6) — price (right-aligned, monospace) */}
                                    <div x-show="i.price > 0" class="text-[13px] font-mono font-semibold text-slate-700 tabular-nums" x-text="'$' + ((i.price || 0) / 100).toFixed(0)"></div>
                                    {/* Status icons — slate-300 default, semantic color when active */}
                                    <div class="flex items-center gap-1 text-slate-300">
                                        <span class="w-5 h-5 inline-flex items-center justify-center" x-bind:class="i.statusFlags?.reportPublished ? 'text-emerald-500' : ''" x-bind:title="i.statusFlags?.reportPublished ? 'Report published' : 'Report not yet published'" x-bind:aria-label="i.statusFlags?.reportPublished ? 'Report published' : 'Report not yet published'">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/><path fill-rule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd"/></svg>
                                        </span>
                                        <span class="w-5 h-5 inline-flex items-center justify-center" x-bind:class="i.statusFlags?.agreementSigned ? 'text-emerald-500' : ''" x-bind:title="i.statusFlags?.agreementSigned ? 'Agreement signed' : 'Agreement not yet signed'" x-bind:aria-label="i.statusFlags?.agreementSigned ? 'Agreement signed' : 'Agreement not yet signed'">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
                                        </span>
                                        <span class="w-5 h-5 inline-flex items-center justify-center" x-bind:class="i.statusFlags?.paid ? 'text-emerald-500' : (i.price > 0 ? 'text-amber-500' : '')" x-bind:title="i.statusFlags?.paid ? 'Paid' : (i.price > 0 ? 'Payment pending' : 'No payment required')" x-bind:aria-label="i.statusFlags?.paid ? 'Paid' : (i.price > 0 ? 'Payment pending' : 'No payment required')">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm12 4a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4a2 2 0 012-2h10zm-7 5a2 2 0 100-4 2 2 0 000 4z"/></svg>
                                        </span>
                                        <span x-show="i.statusFlags?.flagged" class="w-5 h-5 inline-flex items-center justify-center text-rose-500" title="Flagged: invoice overdue or other attention needed" aria-label="Flagged">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z" clip-rule="evenodd"/></svg>
                                        </span>
                                    </div>
                                    <div x-data="actionMenu({ id: i.id, status: i.status })" class="relative ml-3">
                                        <button type="button" x-on:click="open = !open" class="text-slate-400 hover:text-slate-700 px-2 text-lg font-bold">•••</button>
                                        <div x-show="open" {...{ 'x-cloak': true, 'x-on:click.outside': 'open = false' }} class="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 min-w-[140px]">
                                            <template x-for="a in validActions()" {...{ 'x-bind:key': 'a' }}>
                                                <button type="button" x-on:click="run(a)" class="block w-full text-left px-4 py-2 text-sm hover:bg-slate-50" x-text="actionLabel(a)"></button>
                                            </template>
                                        </div>
                                    </div>
                                </div>
                            </template>
                        </div>
                    </section>

                    {/* Section: Later */}
                    <section x-show="!loading && (buckets.later.length > 0 || buckets.laterTotal > 0)" {...{ 'x-cloak': true }} class="bg-white border border-slate-200 rounded-md">
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
                                <div class="px-5 py-3 border-t border-slate-100 flex items-center gap-3" data-test="inspection-row">
                                    <a x-bind:href="'/inspections/' + i.id + '/edit'" class="flex-1 min-w-0">
                                        <p class="font-bold text-slate-900 truncate text-[14px]" x-text="i.propertyAddress || i.address || '(no address)'"></p>
                                        <p class="text-[12px] text-slate-500 mt-0.5">
                                            <span x-text="i.clientName || '—'"></span>
                                            <template x-if="i.agentName"><span> · <span class="text-slate-400">via</span> <span x-text="i.agentName"></span></span></template>
                                            {/* Sprint 2 S2-2 — sibling-count badge for multi-inspection requests. */}
                                            <template x-if="i.siblingCount && i.siblingCount > 1">
                                                <span> · <span class="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold ring-1 ring-inset ring-indigo-200" x-text="i.siblingCount + ' inspections'"></span></span>
                                            </template>
                                            <span> · </span>
                                            <span x-text="i.date ? new Date(i.date).toLocaleString() : 'no date'"></span>
                                        </p>
                                        {/* Spec 5B P2B — defect chips per inspection. Hidden when all zero. */}
                                        <div class="mt-1 flex items-center gap-1.5" x-show="i.defectStats && (i.defectStats.safety + i.defectStats.recommendation + i.defectStats.maintenance) > 0">
                                            <span x-show="i.defectStats?.safety > 0" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-50 text-rose-700" x-text="'🔴 ' + i.defectStats.safety + ' safety'"></span>
                                            <span x-show="i.defectStats?.recommendation > 0" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-50 text-amber-700" x-text="'🟡 ' + i.defectStats.recommendation + ' rec'"></span>
                                            <span x-show="i.defectStats?.maintenance > 0" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-sky-50 text-sky-700" x-text="'🔵 ' + i.defectStats.maintenance + ' maint'"></span>
                                        </div>
                                    </a>
                                    {/* Sub-spec B Task 7 (B-6) — price (right-aligned, monospace) */}
                                    <div x-show="i.price > 0" class="text-[13px] font-mono font-semibold text-slate-700 tabular-nums" x-text="'$' + ((i.price || 0) / 100).toFixed(0)"></div>
                                    {/* Status icons — slate-300 default, semantic color when active */}
                                    <div class="flex items-center gap-1 text-slate-300">
                                        <span class="w-5 h-5 inline-flex items-center justify-center" x-bind:class="i.statusFlags?.reportPublished ? 'text-emerald-500' : ''" x-bind:title="i.statusFlags?.reportPublished ? 'Report published' : 'Report not yet published'" x-bind:aria-label="i.statusFlags?.reportPublished ? 'Report published' : 'Report not yet published'">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/><path fill-rule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd"/></svg>
                                        </span>
                                        <span class="w-5 h-5 inline-flex items-center justify-center" x-bind:class="i.statusFlags?.agreementSigned ? 'text-emerald-500' : ''" x-bind:title="i.statusFlags?.agreementSigned ? 'Agreement signed' : 'Agreement not yet signed'" x-bind:aria-label="i.statusFlags?.agreementSigned ? 'Agreement signed' : 'Agreement not yet signed'">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
                                        </span>
                                        <span class="w-5 h-5 inline-flex items-center justify-center" x-bind:class="i.statusFlags?.paid ? 'text-emerald-500' : (i.price > 0 ? 'text-amber-500' : '')" x-bind:title="i.statusFlags?.paid ? 'Paid' : (i.price > 0 ? 'Payment pending' : 'No payment required')" x-bind:aria-label="i.statusFlags?.paid ? 'Paid' : (i.price > 0 ? 'Payment pending' : 'No payment required')">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm12 4a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4a2 2 0 012-2h10zm-7 5a2 2 0 100-4 2 2 0 000 4z"/></svg>
                                        </span>
                                        <span x-show="i.statusFlags?.flagged" class="w-5 h-5 inline-flex items-center justify-center text-rose-500" title="Flagged: invoice overdue or other attention needed" aria-label="Flagged">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z" clip-rule="evenodd"/></svg>
                                        </span>
                                    </div>
                                    <div x-data="actionMenu({ id: i.id, status: i.status })" class="relative ml-3">
                                        <button type="button" x-on:click="open = !open" class="text-slate-400 hover:text-slate-700 px-2 text-lg font-bold">•••</button>
                                        <div x-show="open" {...{ 'x-cloak': true, 'x-on:click.outside': 'open = false' }} class="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 min-w-[140px]">
                                            <template x-for="a in validActions()" {...{ 'x-bind:key': 'a' }}>
                                                <button type="button" x-on:click="run(a)" class="block w-full text-left px-4 py-2 text-sm hover:bg-slate-50" x-text="actionLabel(a)"></button>
                                            </template>
                                        </div>
                                    </div>
                                </div>
                            </template>
                            <div x-show="buckets.laterTotal > buckets.later.length" class="px-5 py-3 border-t border-slate-100">
                                <button type="button" x-on:click="loadAllLater()"
                                        class="text-sm text-indigo-600 font-semibold hover:text-indigo-800 transition-colors"
                                        x-text="'Show all (' + buckets.later.length + ' of ' + buckets.laterTotal + ')'"></button>
                            </div>
                        </div>
                    </section>

                    {/* Section: Recent Reports */}
                    <section id="bucket-recentReports" x-show="!loading && buckets.recentReports.length > 0" {...{ 'x-cloak': true }} class="bg-white border border-slate-200 rounded-md scroll-mt-20">
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
                                <div class="px-5 py-3 border-t border-slate-100 flex items-center gap-3" data-test="inspection-row">
                                    <a x-bind:href="'/inspections/' + i.id + '/edit'" class="flex-1 min-w-0">
                                        <p class="font-bold text-slate-900 truncate text-[14px]" x-text="i.propertyAddress || i.address || '(no address)'"></p>
                                        <p class="text-[12px] text-slate-500 mt-0.5">
                                            <span x-text="i.clientName || '—'"></span>
                                            <template x-if="i.agentName"><span> · <span class="text-slate-400">via</span> <span x-text="i.agentName"></span></span></template>
                                            {/* Sprint 2 S2-2 — sibling-count badge for multi-inspection requests. */}
                                            <template x-if="i.siblingCount && i.siblingCount > 1">
                                                <span> · <span class="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold ring-1 ring-inset ring-indigo-200" x-text="i.siblingCount + ' inspections'"></span></span>
                                            </template>
                                            <span> · </span>
                                            <span x-text="i.date ? new Date(i.date).toLocaleString() : 'no date'"></span>
                                        </p>
                                        {/* Spec 5B P2B — defect chips per inspection. Hidden when all zero. */}
                                        <div class="mt-1 flex items-center gap-1.5" x-show="i.defectStats && (i.defectStats.safety + i.defectStats.recommendation + i.defectStats.maintenance) > 0">
                                            <span x-show="i.defectStats?.safety > 0" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-50 text-rose-700" x-text="'🔴 ' + i.defectStats.safety + ' safety'"></span>
                                            <span x-show="i.defectStats?.recommendation > 0" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-50 text-amber-700" x-text="'🟡 ' + i.defectStats.recommendation + ' rec'"></span>
                                            <span x-show="i.defectStats?.maintenance > 0" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-sky-50 text-sky-700" x-text="'🔵 ' + i.defectStats.maintenance + ' maint'"></span>
                                        </div>
                                    </a>
                                    {/* Sub-spec B Task 7 (B-6) — price (right-aligned, monospace) */}
                                    <div x-show="i.price > 0" class="text-[13px] font-mono font-semibold text-slate-700 tabular-nums" x-text="'$' + ((i.price || 0) / 100).toFixed(0)"></div>
                                    {/* Status icons — slate-300 default, semantic color when active */}
                                    <div class="flex items-center gap-1 text-slate-300">
                                        <span class="w-5 h-5 inline-flex items-center justify-center" x-bind:class="i.statusFlags?.reportPublished ? 'text-emerald-500' : ''" x-bind:title="i.statusFlags?.reportPublished ? 'Report published' : 'Report not yet published'" x-bind:aria-label="i.statusFlags?.reportPublished ? 'Report published' : 'Report not yet published'">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/><path fill-rule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd"/></svg>
                                        </span>
                                        <span class="w-5 h-5 inline-flex items-center justify-center" x-bind:class="i.statusFlags?.agreementSigned ? 'text-emerald-500' : ''" x-bind:title="i.statusFlags?.agreementSigned ? 'Agreement signed' : 'Agreement not yet signed'" x-bind:aria-label="i.statusFlags?.agreementSigned ? 'Agreement signed' : 'Agreement not yet signed'">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
                                        </span>
                                        <span class="w-5 h-5 inline-flex items-center justify-center" x-bind:class="i.statusFlags?.paid ? 'text-emerald-500' : (i.price > 0 ? 'text-amber-500' : '')" x-bind:title="i.statusFlags?.paid ? 'Paid' : (i.price > 0 ? 'Payment pending' : 'No payment required')" x-bind:aria-label="i.statusFlags?.paid ? 'Paid' : (i.price > 0 ? 'Payment pending' : 'No payment required')">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm12 4a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4a2 2 0 012-2h10zm-7 5a2 2 0 100-4 2 2 0 000 4z"/></svg>
                                        </span>
                                        <span x-show="i.statusFlags?.flagged" class="w-5 h-5 inline-flex items-center justify-center text-rose-500" title="Flagged: invoice overdue or other attention needed" aria-label="Flagged">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z" clip-rule="evenodd"/></svg>
                                        </span>
                                    </div>
                                    <div x-data="actionMenu({ id: i.id, status: i.status })" class="relative ml-3">
                                        <button type="button" x-on:click="open = !open" class="text-slate-400 hover:text-slate-700 px-2 text-lg font-bold">•••</button>
                                        <div x-show="open" {...{ 'x-cloak': true, 'x-on:click.outside': 'open = false' }} class="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 min-w-[140px]">
                                            <template x-for="a in validActions()" {...{ 'x-bind:key': 'a' }}>
                                                <button type="button" x-on:click="run(a)" class="block w-full text-left px-4 py-2 text-sm hover:bg-slate-50" x-text="actionLabel(a)"></button>
                                            </template>
                                        </div>
                                    </div>
                                </div>
                            </template>
                        </div>
                    </section>

                    {/* Section: Cancelled */}
                    <section x-show="!loading && buckets.cancelled.length > 0" {...{ 'x-cloak': true }} class="bg-white border border-slate-200 rounded-md">
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
                                <div class="px-5 py-3 border-t border-slate-100 flex items-center gap-3" data-test="inspection-row">
                                    <a x-bind:href="'/inspections/' + i.id + '/edit'" class="flex-1 min-w-0">
                                        <p class="font-bold text-slate-900 truncate text-[14px]" x-text="i.propertyAddress || i.address || '(no address)'"></p>
                                        <p class="text-[12px] text-slate-500 mt-0.5">
                                            <span x-text="i.clientName || '—'"></span>
                                            <template x-if="i.agentName"><span> · <span class="text-slate-400">via</span> <span x-text="i.agentName"></span></span></template>
                                            {/* Sprint 2 S2-2 — sibling-count badge for multi-inspection requests. */}
                                            <template x-if="i.siblingCount && i.siblingCount > 1">
                                                <span> · <span class="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold ring-1 ring-inset ring-indigo-200" x-text="i.siblingCount + ' inspections'"></span></span>
                                            </template>
                                            <span> · </span>
                                            <span x-text="i.date ? new Date(i.date).toLocaleString() : 'no date'"></span>
                                        </p>
                                        {/* Spec 5B P2B — defect chips per inspection. Hidden when all zero. */}
                                        <div class="mt-1 flex items-center gap-1.5" x-show="i.defectStats && (i.defectStats.safety + i.defectStats.recommendation + i.defectStats.maintenance) > 0">
                                            <span x-show="i.defectStats?.safety > 0" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-rose-50 text-rose-700" x-text="'🔴 ' + i.defectStats.safety + ' safety'"></span>
                                            <span x-show="i.defectStats?.recommendation > 0" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-50 text-amber-700" x-text="'🟡 ' + i.defectStats.recommendation + ' rec'"></span>
                                            <span x-show="i.defectStats?.maintenance > 0" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-sky-50 text-sky-700" x-text="'🔵 ' + i.defectStats.maintenance + ' maint'"></span>
                                        </div>
                                    </a>
                                    {/* Sub-spec B Task 7 (B-6) — price (right-aligned, monospace) */}
                                    <div x-show="i.price > 0" class="text-[13px] font-mono font-semibold text-slate-700 tabular-nums" x-text="'$' + ((i.price || 0) / 100).toFixed(0)"></div>
                                    {/* Status icons — slate-300 default, semantic color when active */}
                                    <div class="flex items-center gap-1 text-slate-300">
                                        <span class="w-5 h-5 inline-flex items-center justify-center" x-bind:class="i.statusFlags?.reportPublished ? 'text-emerald-500' : ''" x-bind:title="i.statusFlags?.reportPublished ? 'Report published' : 'Report not yet published'" x-bind:aria-label="i.statusFlags?.reportPublished ? 'Report published' : 'Report not yet published'">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/><path fill-rule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd"/></svg>
                                        </span>
                                        <span class="w-5 h-5 inline-flex items-center justify-center" x-bind:class="i.statusFlags?.agreementSigned ? 'text-emerald-500' : ''" x-bind:title="i.statusFlags?.agreementSigned ? 'Agreement signed' : 'Agreement not yet signed'" x-bind:aria-label="i.statusFlags?.agreementSigned ? 'Agreement signed' : 'Agreement not yet signed'">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
                                        </span>
                                        <span class="w-5 h-5 inline-flex items-center justify-center" x-bind:class="i.statusFlags?.paid ? 'text-emerald-500' : (i.price > 0 ? 'text-amber-500' : '')" x-bind:title="i.statusFlags?.paid ? 'Paid' : (i.price > 0 ? 'Payment pending' : 'No payment required')" x-bind:aria-label="i.statusFlags?.paid ? 'Paid' : (i.price > 0 ? 'Payment pending' : 'No payment required')">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm12 4a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4a2 2 0 012-2h10zm-7 5a2 2 0 100-4 2 2 0 000 4z"/></svg>
                                        </span>
                                        <span x-show="i.statusFlags?.flagged" class="w-5 h-5 inline-flex items-center justify-center text-rose-500" title="Flagged: invoice overdue or other attention needed" aria-label="Flagged">
                                            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z" clip-rule="evenodd"/></svg>
                                        </span>
                                    </div>
                                    <div x-data="actionMenu({ id: i.id, status: i.status })" class="relative ml-3">
                                        <button type="button" x-on:click="open = !open" class="text-slate-400 hover:text-slate-700 px-2 text-lg font-bold">•••</button>
                                        <div x-show="open" {...{ 'x-cloak': true, 'x-on:click.outside': 'open = false' }} class="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 min-w-[140px]">
                                            <template x-for="a in validActions()" {...{ 'x-bind:key': 'a' }}>
                                                <button type="button" x-on:click="run(a)" class="block w-full text-left px-4 py-2 text-sm hover:bg-slate-50" x-text="actionLabel(a)"></button>
                                            </template>
                                        </div>
                                    </div>
                                </div>
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
