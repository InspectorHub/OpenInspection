/**
 * P3 post-launch — Analytics & Metrics settings page.
 *
 * Placeholder dashboard surfaces for inspections-per-month trend,
 * recurring defect ranking, and team member growth. Data populated
 * by the `analyticsAdmin()` Alpine factory when the backing API
 * endpoints are wired up.
 */
import { MainLayout } from '../layouts/main-layout';
import { PageHeader } from '../components/page-header';
import type { BrandingConfig } from '../../types/auth';

interface Props {
    branding?: BrandingConfig | undefined;
}

export const SettingsAnalyticsPage = ({ branding }: Props): JSX.Element => (
    <MainLayout title="Analytics & Metrics" {...(branding ? { branding } : {})}>
        <div x-data="analyticsAdmin()" {...{ 'x-init': 'init()' }}
             class="max-w-5xl mx-auto p-6 space-y-6">
            <PageHeader
                eyebrow="Settings"
                eyebrowColor="indigo"
                title="Analytics & Metrics"
                meta="Inspection volume, recurring defects, and team growth."
            />

            {/* Loading skeleton */}
            <div x-show="loading" aria-busy="true" class="space-y-4">
                <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <div class="ih-skeleton ih-skeleton--text" style="width: 40%;" />
                    <div class="ih-skeleton ih-skeleton--text mt-3" style="width: 100%; height: 10rem;" />
                </div>
            </div>

            <div x-show="!loading" class="space-y-6">
                {/* Inspections per month */}
                <section class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h2 class="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">Inspections per month</h2>
                    <p class="text-xs text-slate-500 dark:text-slate-400 mb-4">
                        12-month rolling trend. Chart renders when data is available.
                    </p>
                    <div class="h-48 flex items-center justify-center border border-dashed border-slate-200 dark:border-slate-600 rounded-md">
                        <span class="text-xs text-slate-400 dark:text-slate-500" x-text="chartPlaceholder">No data yet</span>
                    </div>
                </section>

                {/* Recurring defects ranking */}
                <section class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h2 class="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">Recurring defects</h2>
                    <p class="text-xs text-slate-500 dark:text-slate-400 mb-4">
                        Most frequently flagged items across all inspections.
                    </p>
                    <div x-show="defects.length === 0" class="text-xs text-slate-400 dark:text-slate-500 py-4 text-center">No defect data yet</div>
                    <table x-show="defects.length > 0" class="w-full text-sm">
                        <thead>
                            <tr class="border-b border-slate-100 dark:border-slate-700 text-left">
                                <th class="py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Item</th>
                                <th class="py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 text-right">Occurrences</th>
                            </tr>
                        </thead>
                        <tbody>
                            <template {...{ 'x-for': 'd in defects', ':key': 'd.name' }}>
                                <tr class="border-b border-slate-50 dark:border-slate-700/50">
                                    <td class="py-2 text-slate-700 dark:text-slate-300" x-text="d.name" />
                                    <td class="py-2 text-right font-mono text-slate-900 dark:text-slate-100" x-text="d.count" />
                                </tr>
                            </template>
                        </tbody>
                    </table>
                </section>

                {/* Team member growth */}
                <section class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h2 class="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">Team growth</h2>
                    <p class="text-xs text-slate-500 dark:text-slate-400 mb-4">
                        Active inspectors, specialists, and apprentices over time.
                    </p>
                    <div class="grid grid-cols-3 gap-4">
                        <div class="text-center">
                            <div class="text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums" x-text="teamCounts.inspectors">0</div>
                            <div class="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mt-1">Inspectors</div>
                        </div>
                        <div class="text-center">
                            <div class="text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums" x-text="teamCounts.specialists">0</div>
                            <div class="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mt-1">Specialists</div>
                        </div>
                        <div class="text-center">
                            <div class="text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums" x-text="teamCounts.apprentices">0</div>
                            <div class="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mt-1">Apprentices</div>
                        </div>
                    </div>
                </section>
            </div>

            <p class="text-xs text-rose-600 dark:text-rose-400" x-show="error" x-text="error" />
        </div>
        <script src="/js/auth.js" />
        <script src="/js/settings-analytics.js" />
    </MainLayout>
);
