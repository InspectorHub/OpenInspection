import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';
import { PageHeader } from '../components/page-header';

interface Props { branding?: BrandingConfig; }

export const NotificationsPage = ({ branding }: Props): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <MainLayout title={`${siteName} | Notifications`} {...(branding ? { branding } : {})}>
            <div class="space-y-6 animate-fade-in" x-data="notificationsApp()" x-init="load()">
                <PageHeader
                    eyebrow="NOTIFICATIONS"
                    eyebrowColor="slate"
                    title="Notifications"
                    meta={
                        <span x-text="`${unreadCount || 0} unread${urgentCount ? ' · ' + urgentCount + ' urgent' : ''}`"></span>
                    }
                    actions={
                        <button
                            x-on:click="markAllRead()"
                            class="h-8 px-4 rounded-md bg-indigo-600 text-white font-bold text-[13px] hover:bg-indigo-700 active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                        >
                            Mark all read
                        </button>
                    }
                />

                <div class="flex gap-2">
                    <button x-on:click="setFilter('all')" x-bind:class="filter==='all' ? 'bg-indigo-600 text-white' : 'ring-2 ring-slate-200 text-slate-600'" class="px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all">All</button>
                    <button x-on:click="setFilter('unread')" x-bind:class="filter==='unread' ? 'bg-indigo-600 text-white' : 'ring-2 ring-slate-200 text-slate-600'" class="px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all">Unread</button>
                </div>

                <div class="glass-panel rounded-xl shadow-xl shadow-slate-100/50 overflow-hidden">
                    <template x-if="items.length === 0 && !loading">
                        <div class="py-24 text-center space-y-3">
                            <div class="ih-empty-state"><h3 class="ih-empty-state__title">No notifications yet</h3><p class="ih-empty-state__subline">Events will appear here as they happen.</p></div>
                            <div class="text-xs text-slate-400">Tip: trigger your first booking on <a href="/book" class="text-indigo-600 font-bold hover:underline">/book</a> to see this inbox light up.</div>
                        </div>
                    </template>
                    <template x-for="n in items" x-bind:key="n.id">
                        <div class="flex items-start gap-4 p-6 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-all" x-bind:class="!n.readAt && 'bg-indigo-50/40'">
                            <div class="w-2 h-2 mt-2 rounded-full flex-shrink-0" x-bind:class="n.readAt ? 'bg-transparent' : 'bg-indigo-500'"></div>
                            <div class="flex-1 min-w-0">
                                <div class="flex items-baseline gap-3">
                                    <span class="text-[10px] font-bold uppercase tracking-widest text-indigo-600" x-text="n.type"></span>
                                    <span class="text-xs text-slate-400" x-text="formatTime(n.createdAt)"></span>
                                </div>
                                <h3 class="mt-1 font-bold text-slate-900" x-text="n.title"></h3>
                                <p class="text-sm text-slate-500 mt-0.5" x-text="n.body" x-show="n.body"></p>
                            </div>
                            <div class="flex items-center gap-2 flex-shrink-0">
                                <button x-show="!n.readAt" x-on:click="markRead(n.id)" class="text-xs text-indigo-600 hover:underline">Mark read</button>
                                <button x-on:click="archive(n.id)" class="text-xs text-slate-400 hover:text-rose-500" aria-label="Archive">×</button>
                            </div>
                        </div>
                    </template>
                    <template x-if="loading">
                        <div aria-busy="true" class="space-y-2 py-6"><span class="sr-only">Loading…</span><div class="ih-skeleton ih-skeleton--text" style="width: 50%; margin: 0 auto;"></div></div>
                    </template>
                </div>

                <div x-show="nextCursor" class="text-center">
                    <button x-on:click="loadMore()" class="px-3 py-2 rounded-md ring-2 ring-slate-200 text-slate-600 text-xs font-bold uppercase tracking-[0.2em] hover:bg-slate-50 transition-all">Load more</button>
                </div>
            </div>

            <script src="/js/auth.js"></script>
            <script src="/js/toast.js"></script>
            <script src="/vendor/alpine.min.js" defer></script>
            <script src="/js/notifications.js"></script>
        </MainLayout>
    );
};
