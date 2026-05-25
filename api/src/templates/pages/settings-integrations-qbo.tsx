import { MainLayout } from '../layouts/main-layout';
import type { BrandingConfig } from '../../types/auth';

export function SettingsIntegrationsQBOPage({ branding }: { branding?: BrandingConfig | undefined }) {
    return MainLayout({
        title: 'QuickBooks Integration',
        branding,
        children: (
            <div class="max-w-2xl mx-auto py-10 px-4"
                 x-data="qboSettings()"
                 x-init="init()">

                <div class="flex items-center gap-3 mb-8">
                    <a href="/settings/integrations" class="text-ink-400 hover:text-ink-600 transition-colors">
                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
                        </svg>
                    </a>
                    <h1 class="text-2xl font-display font-bold text-ink-900 dark:text-white">QuickBooks Online</h1>
                </div>

                {/* Not connected */}
                <div x-show="!status" class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-8 text-center">
                    <div class="w-16 h-16 bg-[#2CA01C]/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <svg class="w-9 h-9" viewBox="0 0 32 32">
                            <rect width="32" height="32" rx="8" fill="#2CA01C"/>
                            <text x="5" y="22" fontSize="16" fill="white" fontWeight="bold">QB</text>
                        </svg>
                    </div>
                    <h2 class="text-lg font-semibold text-ink-900 dark:text-white mb-2">Connect QuickBooks Online</h2>
                    <ul class="text-sm text-ink-600 dark:text-ink-400 text-left max-w-xs mx-auto mb-6 space-y-2">
                        <li class="flex items-start gap-2"><span class="text-green-500 mt-0.5">&#x2713;</span> Real-time invoice sync</li>
                        <li class="flex items-start gap-2"><span class="text-green-500 mt-0.5">&#x2713;</span> Automatic payment status updates</li>
                        <li class="flex items-start gap-2"><span class="text-green-500 mt-0.5">&#x2713;</span> Duplicate customer detection</li>
                        <li class="flex items-start gap-2"><span class="text-green-500 mt-0.5">&#x2713;</span> Invoice void and refund sync</li>
                    </ul>
                    <a href="/settings/integrations/qbo/connect"
                       class="inline-flex items-center gap-2 px-6 py-3 bg-[#2CA01C] text-white rounded-xl font-semibold hover:bg-[#237a16] transition-colors">
                        Connect QuickBooks
                    </a>
                </div>

                {/* Connected */}
                <div x-show="status" class="space-y-4">
                    {/* Expiry warning */}
                    <div x-show="expiryWarning"
                         class="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-200 text-sm">
                        <svg class="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856C18.48 19 19 18.48 19 17.938V6.062C19 5.52 18.48 5 17.938 5H6.062C5.52 5 5 5.52 5 6.062v11.876C5 18.48 5.52 19 6.062 19z"/>
                        </svg>
                        <span>Your QuickBooks connection expires soon. <a href="/settings/integrations/qbo/connect" class="underline font-semibold">Reconnect to avoid interruption.</a></span>
                    </div>

                    {/* Status card */}
                    <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6">
                        <div class="flex items-start justify-between mb-4">
                            <div>
                                <p class="font-semibold text-ink-900 dark:text-white" x-text="status?.companyName ?? 'Connected'"></p>
                                <p class="text-sm text-ink-500 dark:text-ink-400 mt-0.5">
                                    Last synced: <span x-text="lastSyncedLabel"></span>
                                </p>
                            </div>
                            <span class="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
                                  x-bind:class="status?.syncEnabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'">
                                <span class="w-1.5 h-1.5 rounded-full"
                                      x-bind:class="status?.syncEnabled ? 'bg-green-500' : 'bg-slate-400'"></span>
                                <span x-text="status?.syncEnabled ? 'Active' : 'Paused'"></span>
                            </span>
                        </div>

                        <div class="flex gap-2 flex-wrap">
                            <button type="button" x-on:click="triggerSync()"
                                    class="px-4 py-2 text-sm font-medium bg-blueprint-50 text-blueprint-700 rounded-xl hover:bg-blueprint-100 transition-colors">
                                Sync Now
                            </button>
                            <button type="button" x-on:click="togglePause()"
                                    class="px-4 py-2 text-sm font-medium bg-slate-100 dark:bg-slate-700 text-ink-700 dark:text-ink-300 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                                    x-text="status?.syncEnabled ? 'Pause Sync' : 'Resume Sync'">
                            </button>
                            <button type="button" x-on:click="disconnect()"
                                    class="px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors">
                                Disconnect
                            </button>
                        </div>
                    </div>

                    {/* Error count */}
                    <div x-show="status?.openErrors > 0" class="bg-white dark:bg-slate-800 border border-red-200 dark:border-red-800 rounded-2xl p-6">
                        <h3 class="font-semibold text-ink-900 dark:text-white mb-3 flex items-center gap-2">
                            <svg class="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                            </svg>
                            Sync Errors (<span x-text="status?.openErrors"></span>)
                        </h3>
                        <p class="text-sm text-ink-500 dark:text-ink-400">Check the sync error log for details. Errors will retry automatically on the next sync.</p>
                    </div>
                </div>

                <script>{`
                    function qboSettings() {
                        return {
                            status: null,
                            async init() {
                                const r = await fetch('/settings/integrations/qbo/status');
                                const j = await r.json();
                                this.status = j.data;
                            },
                            get expiryWarning() {
                                if (!this.status) return false;
                                const thirtyDays = 30 * 24 * 60 * 60;
                                return this.status.refreshTokenExpiresAt < Math.floor(Date.now() / 1000) + thirtyDays;
                            },
                            get lastSyncedLabel() {
                                if (!this.status?.lastSyncAt) return 'Never';
                                const diff = Math.floor(Date.now() / 1000) - this.status.lastSyncAt;
                                if (diff < 60) return 'Just now';
                                if (diff < 3600) return Math.floor(diff / 60) + ' minutes ago';
                                return Math.floor(diff / 3600) + ' hours ago';
                            },
                            async triggerSync() {
                                await fetch('/settings/integrations/qbo/sync', { method: 'POST' });
                                alert('Sync started — check back in a moment.');
                            },
                            async togglePause() {
                                const r = await fetch('/settings/integrations/qbo/pause', { method: 'POST' });
                                const j = await r.json();
                                if (this.status) this.status.syncEnabled = j.syncEnabled;
                            },
                            async disconnect() {
                                if (!confirm('Disconnect QuickBooks? This will stop all syncing. Your QuickBooks data will not be deleted.')) return;
                                await fetch('/settings/integrations/qbo/disconnect', { method: 'POST' });
                                this.status = null;
                            },
                        };
                    }
                `}</script>
            </div>
        ),
    });
}
