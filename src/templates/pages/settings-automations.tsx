import { MainLayout } from '../layouts/main-layout';
import type { BrandingConfig } from '../../types/auth';

interface SettingsAutomationsPageProps {
    branding?: BrandingConfig | undefined;
}

export function SettingsAutomationsPage({ branding }: SettingsAutomationsPageProps): JSX.Element {
    return (
        <MainLayout title="Automations" branding={branding}>
            <div x-data="automations" class="max-w-3xl mx-auto px-4 py-8">
                <div class="mb-6">
                    <h1 class="text-xl font-bold text-slate-900">Email Automations</h1>
                    <p class="text-sm text-slate-500 mt-1">Emails sent automatically when inspection events occur.</p>
                </div>

                <div x-show="loading" class="text-sm text-slate-400 py-8 text-center">Loading...</div>
                <div x-show="!!error" x-text="error" class="text-sm text-red-600 py-4" />

                <div x-show="!loading && !error" class="space-y-2">
                    <template x-for="rule in rules" x-bind:key="rule.id">
                        <div class="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-4">
                            <div class="flex-1 min-w-0">
                                <div class="text-sm font-bold text-slate-900" x-text="rule.name" />
                                <div class="text-xs text-slate-400 mt-0.5">
                                    <span x-text="triggerLabel(rule.trigger)" />
                                    <span class="mx-1">·</span>
                                    <span x-text="recipientLabel(rule.recipient)" />
                                    <span class="mx-1">·</span>
                                    <span x-text="delayLabel(rule.delayMinutes)" />
                                </div>
                            </div>
                            <div class="flex items-center gap-2 flex-shrink-0">
                                <span x-show="rule.isDefault" class="text-[9px] font-bold px-1.5 py-0.5 bg-slate-100 text-slate-400 rounded uppercase">Default</span>
                                <button
                                    x-on:click="toggle(rule)"
                                    x-bind:class="rule.active ? 'bg-indigo-500' : 'bg-slate-200'"
                                    class="w-10 h-6 rounded-full relative transition-colors"
                                >
                                    <span x-bind:class="rule.active ? 'right-1' : 'left-1'" class="absolute w-4 h-4 bg-white rounded-full top-1 transition-all" />
                                </button>
                            </div>
                        </div>
                    </template>
                </div>

                <script src="/js/auth.js" />
                <script src="/js/automations.js" />
            </div>
        </MainLayout>
    );
}
