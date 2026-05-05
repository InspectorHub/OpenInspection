import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';
import { CancelModal } from '../components/cancel-modal';

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

                {/* Earnings Panel — only visible when there's revenue activity */}
                <div x-data="dashboardEarnings()" x-init="loadEarnings()" x-show="earnings.paid > 0 || earnings.pending > 0" class="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 grid grid-cols-1 md:grid-cols-3 gap-4 mb-6" style="display: none;">
                    <div>
                        <div class="text-[10px] font-bold uppercase tracking-widest text-slate-400">Paid this period</div>
                        <div class="mt-1 text-3xl font-black text-emerald-600" x-text="formatCurrency(earnings.paid)"></div>
                    </div>
                    <div>
                        <div class="text-[10px] font-bold uppercase tracking-widest text-slate-400">Pending</div>
                        <div class="mt-1 text-3xl font-black text-amber-600" x-text="formatCurrency(earnings.pending)"></div>
                    </div>
                    <div>
                        <div class="text-[10px] font-bold uppercase tracking-widest text-slate-400">Paid invoices</div>
                        <div class="mt-1 text-3xl font-black text-slate-900" x-text="earnings.count"></div>
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
                    <div x-show="loading" class="flex items-center justify-center py-16">
                        <div class="relative w-12 h-12">
                            <div class="absolute inset-0 border-4 border-indigo-50 rounded-full"></div>
                            <div class="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                        </div>
                    </div>

                    {/* Section: Needs Attention */}
                    <section x-show="!loading && buckets.needsAttention.length > 0" {...{ 'x-cloak': true }} class="bg-white border border-slate-200 rounded-2xl">
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
                                <div class="px-5 py-3 border-t border-slate-100 flex items-center justify-between" data-test="inspection-row">
                                    <a x-bind:href="'/inspections/' + i.id + '/edit'" class="flex-1 min-w-0">
                                        <p class="font-bold text-slate-900 truncate" x-text="i.propertyAddress || i.address || '(no address)'"></p>
                                        <p class="text-xs text-slate-500" x-text="(i.clientName || '—') + ' · ' + (i.date ? new Date(i.date).toLocaleString() : 'no date')"></p>
                                    </a>
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
                    <section x-show="!loading && buckets.today.length > 0" {...{ 'x-cloak': true }} class="bg-white border border-slate-200 rounded-2xl">
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
                                <div class="px-5 py-3 border-t border-slate-100 flex items-center justify-between" data-test="inspection-row">
                                    <a x-bind:href="'/inspections/' + i.id + '/edit'" class="flex-1 min-w-0">
                                        <p class="font-bold text-slate-900 truncate" x-text="i.propertyAddress || i.address || '(no address)'"></p>
                                        <p class="text-xs text-slate-500" x-text="(i.clientName || '—') + ' · ' + (i.date ? new Date(i.date).toLocaleString() : 'no date')"></p>
                                    </a>
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
                    <section x-show="!loading && todayEvents.length > 0" {...{ 'x-cloak': true }} class="bg-white border border-slate-200 rounded-2xl">
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
                    <section x-show="!loading && buckets.thisWeek.length > 0" {...{ 'x-cloak': true }} class="bg-white border border-slate-200 rounded-2xl">
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
                                <div class="px-5 py-3 border-t border-slate-100 flex items-center justify-between" data-test="inspection-row">
                                    <a x-bind:href="'/inspections/' + i.id + '/edit'" class="flex-1 min-w-0">
                                        <p class="font-bold text-slate-900 truncate" x-text="i.propertyAddress || i.address || '(no address)'"></p>
                                        <p class="text-xs text-slate-500" x-text="(i.clientName || '—') + ' · ' + (i.date ? new Date(i.date).toLocaleString() : 'no date')"></p>
                                    </a>
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
                    <section x-show="!loading && (buckets.later.length > 0 || buckets.laterTotal > 0)" {...{ 'x-cloak': true }} class="bg-white border border-slate-200 rounded-2xl">
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
                                <div class="px-5 py-3 border-t border-slate-100 flex items-center justify-between" data-test="inspection-row">
                                    <a x-bind:href="'/inspections/' + i.id + '/edit'" class="flex-1 min-w-0">
                                        <p class="font-bold text-slate-900 truncate" x-text="i.propertyAddress || i.address || '(no address)'"></p>
                                        <p class="text-xs text-slate-500" x-text="(i.clientName || '—') + ' · ' + (i.date ? new Date(i.date).toLocaleString() : 'no date')"></p>
                                    </a>
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
                    <section x-show="!loading && buckets.recentReports.length > 0" {...{ 'x-cloak': true }} class="bg-white border border-slate-200 rounded-2xl">
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
                                <div class="px-5 py-3 border-t border-slate-100 flex items-center justify-between" data-test="inspection-row">
                                    <a x-bind:href="'/inspections/' + i.id + '/edit'" class="flex-1 min-w-0">
                                        <p class="font-bold text-slate-900 truncate" x-text="i.propertyAddress || i.address || '(no address)'"></p>
                                        <p class="text-xs text-slate-500" x-text="(i.clientName || '—') + ' · ' + (i.date ? new Date(i.date).toLocaleString() : 'no date')"></p>
                                    </a>
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
                    <section x-show="!loading && buckets.cancelled.length > 0" {...{ 'x-cloak': true }} class="bg-white border border-slate-200 rounded-2xl">
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
                                <div class="px-5 py-3 border-t border-slate-100 flex items-center justify-between" data-test="inspection-row">
                                    <a x-bind:href="'/inspections/' + i.id + '/edit'" class="flex-1 min-w-0">
                                        <p class="font-bold text-slate-900 truncate" x-text="i.propertyAddress || i.address || '(no address)'"></p>
                                        <p class="text-xs text-slate-500" x-text="(i.clientName || '—') + ' · ' + (i.date ? new Date(i.date).toLocaleString() : 'no date')"></p>
                                    </a>
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
                    <div x-show="!loading && allBucketsEmpty" {...{ 'x-cloak': true }} class="text-center py-16 text-slate-400">
                        <div class="w-20 h-20 rounded-3xl bg-indigo-50 flex items-center justify-center mx-auto mb-4">
                            <svg class="w-10 h-10 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                        </div>
                        <p class="text-sm">No inspections yet. Create one above to get started.</p>
                    </div>

                    <CancelModal />
                </div>

                {/* Create Inspection Modal */}
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
                                    <input type="text" id="inspectionDate" data-flatpickr data-min-date="today" autocomplete="off" placeholder="YYYY-MM-DD HH:MM"
                                        class="premium-input w-full px-6 py-4 rounded-2xl border-2 border-slate-50 focus:border-emerald-600 outline-none transition-all font-bold text-sm" />
                                </div>
                                <div x-data="contactSelector" class="relative mb-3">
                                    <label class="block text-xs font-bold text-slate-600 mb-1">Search or create contact</label>
                                    <input
                                        type="text"
                                        x-model="searchText"
                                        x-on:input="onInput()"
                                        x-on:focus="showDropdown = searchText.length > 0"
                                        placeholder="Type contact name to search..."
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
                <script src="/js/action-menu.js"></script>
                <script src="/js/dashboard.js"></script>
                <script type="module" src="/js/contact-selector.js"></script>
                <script type="module" src="/js/dashboard-prefetch.js"></script>
            </div>
        </MainLayout>
    );
};
