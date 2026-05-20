/**
 * Design System 0520 subsystem E P6 — IntegrationGrid (M22).
 *
 * Mounted at /settings/integrations-grid (the existing /settings/integrations
 * is the per-integration setting page; this is the workflow-oriented
 * grid view). Renders the 6-row IntegrationsService.status snapshot
 * as cards with connect/reconnect/manage CTAs.
 */
import { MainLayout } from '../layouts/main-layout';
import type { BrandingConfig } from '../../types/auth';

export const IntegrationsGridPage = (
    { branding }: { branding?: BrandingConfig | undefined } = {},
): JSX.Element => (
    <MainLayout title="Integrations" {...(branding ? { branding } : {})}>
        <div x-data="integrationsGrid()" {...{ 'x-init': 'init()' }}
             class="max-w-4xl mx-auto p-6">
            <h1 class="text-2xl font-bold mb-4">Integrations</h1>
            <p class="text-sm text-slate-500 mb-4">
                Connect external services to enrich your inspections,
                send reports, and accept payments.
            </p>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <template {...{ 'x-for': 'i in integrations', ':key': 'i.id' }}>
                    <div class="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                        <div class="flex items-center justify-between mb-2 gap-2">
                            <h3 class="text-base font-bold" x-text="i.name" />
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest"
                                  {...{
                                      ':class': "i.connected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'",
                                      'x-text':  "i.connected ? 'Connected' : 'Not configured'",
                                  }} />
                        </div>
                        <p class="text-xs text-slate-500 mb-3"
                           x-show="i.lastSync"
                           x-text="`Last sync: ${i.lastSync}`" />
                        <button class="px-3 h-7 rounded-md border border-slate-200 bg-white text-xs font-bold capitalize hover:bg-slate-50"
                                x-show="i.action"
                                {...{ '@click': 'action(i)', 'x-text': 'i.action' }} />
                    </div>
                </template>
            </div>

            <p class="text-xs text-rose-600 mt-4" x-show="error" x-text="error" />
        </div>
        <script src="/js/integrations-grid.js"></script>
    </MainLayout>
);
