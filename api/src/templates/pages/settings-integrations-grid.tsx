/**
 * Design System 0520 subsystem E P6 — IntegrationGrid (M22).
 *
 * Mounted at /settings/integrations-grid. Renders 8 integration cards
 * in a 3-column grid with three connection states:
 *   connected (emerald) · available (slate) · attention (amber).
 *
 * Alpine factory: `integrationsAdmin()` (in integrations-grid.js).
 */
import { MainLayout } from '../layouts/main-layout';
import { PageHeader } from '../components/page-header';
import type { BrandingConfig } from '../../types/auth';

export const IntegrationsGridPage = (
    { branding }: { branding?: BrandingConfig | undefined } = {},
): JSX.Element => (
    <MainLayout title="Integrations" {...(branding ? { branding } : {})}>
        <div x-data="integrationsAdmin()" {...{ 'x-init': 'init()' }}
             class="max-w-5xl mx-auto p-6 space-y-6">
            <PageHeader
                eyebrow="Settings"
                eyebrowColor="indigo"
                title="Integrations"
                meta={<span x-text="summary"></span>}
            />

            {/* Loading skeleton */}
            <div x-show="loading" aria-busy="true" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[0, 1, 2].map(() => (
                    <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-5 space-y-3">
                        <div class="ih-skeleton ih-skeleton--text" style="width: 50%;" />
                        <div class="ih-skeleton ih-skeleton--text" style="width: 80%;" />
                        <div class="ih-skeleton ih-skeleton--text" style="width: 30%;" />
                    </div>
                ))}
            </div>

            {/* Integration cards */}
            <div x-show="!loading" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <template {...{ 'x-for': 'i in integrations', ':key': 'i.id' }}>
                    <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-5 flex flex-col gap-3">
                        <div class="flex items-start justify-between gap-2">
                            <h3 class="text-sm font-bold text-slate-900 dark:text-slate-100" x-text="i.name" />
                            <span class="flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest"
                                  {...{
                                      ':class': `i.state === 'connected'
                                          ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                                          : i.state === 'attention'
                                              ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                                              : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'`,
                                      'x-text': `i.state === 'connected' ? 'Connected' : i.state === 'attention' ? 'Attention' : 'Available'`,
                                  }} />
                        </div>
                        <p class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed flex-1" x-text="i.description" />
                        <button class="self-start px-3 h-7 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors capitalize"
                                {...{ '@click': 'configure(i)', 'x-text': "i.state === 'connected' ? 'Configure' : 'Connect'" }} />
                    </div>
                </template>
            </div>

            <p class="text-xs text-rose-600 dark:text-rose-400" x-show="error" x-text="error" />
        </div>
        <script src="/js/auth.js" />
        <script src="/js/integrations-grid.js" />
    </MainLayout>
);
