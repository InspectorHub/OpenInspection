import { MainLayout } from '../layouts/main-layout';
import type { BrandingConfig } from '../../types/auth';

export function SettingsIntegrationsPage({ branding }: { branding?: BrandingConfig | undefined }) {
    return MainLayout({
        title: 'Integrations',
        branding,
        children: (
            <div class="max-w-3xl mx-auto py-10 px-4">
                <h1 class="text-2xl font-display font-bold text-ink-900 dark:text-white mb-2">Integrations</h1>
                <p class="text-ink-600 dark:text-ink-400 mb-8">Connect OpenInspection to your other business tools.</p>

                <div class="grid gap-4">
                    {/* QuickBooks */}
                    <a href="/settings/integrations/qbo"
                       class="flex items-center gap-4 p-5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl hover:shadow-md transition-shadow group">
                        <div class="w-12 h-12 bg-[#2CA01C]/10 rounded-xl flex items-center justify-center flex-shrink-0">
                            <svg class="w-7 h-7" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <rect width="32" height="32" rx="8" fill="#2CA01C"/>
                                <text x="5" y="22" fontSize="16" fill="white" fontWeight="bold">QB</text>
                            </svg>
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="font-semibold text-ink-900 dark:text-white group-hover:text-blueprint-600 transition-colors">QuickBooks Online</p>
                            <p class="text-sm text-ink-500 dark:text-ink-400 mt-0.5">Sync invoices, contacts, and payment status in real time.</p>
                        </div>
                        <svg class="w-5 h-5 text-ink-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                        </svg>
                    </a>
                </div>
            </div>
        ),
    });
}
