import { SettingsLayout } from '../components/settings-layout';
import type { BrandingConfig } from '../../types/auth';

interface SettingsAutomationsPageProps {
    branding?: BrandingConfig | undefined;
}

export function SettingsAutomationsPage({ branding }: SettingsAutomationsPageProps): JSX.Element {
    return (
        <SettingsLayout
            branding={branding}
            title="Settings | Automations"
            group="communication"
            subPage="automations"
            pageTitle="Email automations"
            pageSubtitle="Emails sent automatically when inspection events occur."
        >
            <div x-data="automations" class="max-w-3xl space-y-8">
                <div x-show="loading" aria-busy="true" class="space-y-2 py-6"><span class="sr-only">Loading…</span><div class="ih-skeleton ih-skeleton--text" style="width: 60%;"></div><div class="ih-skeleton ih-skeleton--text" style="width: 85%;"></div><div class="ih-skeleton ih-skeleton--text" style="width: 70%;"></div></div>
                <div x-show="!!error" x-text="error" class="text-sm text-rose-600 py-4" />

                <div x-show="!loading && !error" class="space-y-2">
                    <template x-for="rule in rules" x-bind:key="rule.id">
                        <div class="bg-white border border-surface-200 rounded-md px-4 py-3 flex items-center gap-4">
                            <div class="flex-1 min-w-0">
                                <div class="text-sm font-bold text-ink-900" x-text="rule.name" />
                                <div class="text-xs text-ink-500 mt-0.5">
                                    <span x-text="triggerLabel(rule.trigger)" />
                                    <span class="mx-1">·</span>
                                    <span x-text="recipientLabel(rule.recipient)" />
                                    <span class="mx-1">·</span>
                                    <span x-text="delayLabel(rule.delayMinutes)" />
                                </div>
                            </div>
                            <div class="flex items-center gap-2 flex-shrink-0">
                                <span x-show="rule.isDefault" class="text-[9px] font-bold px-1.5 py-0.5 bg-surface-100 text-ink-500 rounded uppercase">Default</span>
                                <button
                                    x-on:click="toggle(rule)"
                                    x-bind:class="rule.active ? 'bg-blueprint-500' : 'bg-surface-200'"
                                    class="w-10 h-6 rounded-full relative transition-colors"
                                >
                                    <span x-bind:class="rule.active ? 'right-1' : 'left-1'" class="absolute w-4 h-4 bg-white rounded-full top-1 transition-all" />
                                </button>
                            </div>
                        </div>
                    </template>
                </div>

                {/* handoff-decisions §1 — Attention Rules */}
                <section id="attention-rules" class="space-y-4 pt-2 border-t border-surface-200 scroll-mt-24" x-data="attentionRules">
                    <div class="space-y-1 mt-4">
                        <h2 class="text-sm font-bold text-ink-700 uppercase tracking-[0.2em]">Attention Rules</h2>
                        <p class="text-xs text-ink-500">
                            How long an item can stay in a stuck state before it shows up in the dashboard's
                            <em>Needs Attention</em> bucket. Default is 72 hours.
                        </p>
                    </div>

                    <div x-show="loading" aria-busy="true" class="space-y-2 py-2"><span class="sr-only">Loading…</span><div class="ih-skeleton ih-skeleton--text" style="width: 40%;"></div><div class="ih-skeleton ih-skeleton--text" style="width: 30%;"></div></div>
                    <div x-show="!!saveError" x-text="saveError" class="text-xs text-rose-600" />

                    <div x-show="!loading" class="bg-white border border-surface-200 rounded-md divide-y divide-surface-200">
                        <template x-for="row in rows" {...{ 'x-bind:key': 'row.key' }}>
                            <label class="flex items-center gap-4 px-4 py-3">
                                <div class="flex-1 min-w-0">
                                    <div class="text-sm font-semibold text-ink-900" x-text="row.label" />
                                    <div class="text-[11px] text-ink-500 mt-0.5" x-text="row.help" />
                                </div>
                                <div class="flex items-center gap-2 flex-shrink-0">
                                    <input
                                        type="number"
                                        min="1"
                                        max="720"
                                        step="1"
                                        x-bind:value="values[row.key]"
                                        x-on:input="onInput(row.key, $event.target.value)"
                                        class="w-20 px-3 py-1.5 border border-surface-300 rounded text-sm font-mono text-ink-900 text-right focus:outline-none focus:border-blueprint-500"
                                    />
                                    <span class="text-xs text-ink-500 font-medium">hours</span>
                                </div>
                            </label>
                        </template>
                    </div>

                    <div class="flex items-center gap-3">
                        <button
                            type="button"
                            x-on:click="save()"
                            x-bind:disabled="saving || !dirty"
                            x-bind:class="saving || !dirty ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blueprint-600'"
                            class="px-4 py-2 bg-blueprint-500 text-white text-xs font-bold uppercase tracking-widest rounded transition-colors"
                            x-text="saving ? 'Saving…' : 'Save'"
                        />
                        <button
                            type="button"
                            x-on:click="resetDefaults()"
                            class="px-4 py-2 border border-surface-300 text-ink-700 text-xs font-bold uppercase tracking-widest rounded hover:bg-surface-100 transition-colors"
                        >Reset to default</button>
                        <span x-show="saved" class="text-xs text-emerald-600 font-semibold">Saved</span>
                    </div>
                </section>

                <section class="space-y-3 pt-2 border-t border-surface-200">
                    <h2 class="text-sm font-bold text-ink-700 uppercase tracking-[0.2em] mt-4">Recent Activity</h2>
                    <div x-show="logsLoading" class="text-xs text-ink-500">Loading activity…</div>
                    <div x-show="!logsLoading && logs.length === 0" class="text-xs text-ink-500">No automation activity yet.</div>
                    <div x-show="!logsLoading && logs.length > 0" class="space-y-1">
                        <template x-for="log in logs" {...{ 'x-bind:key': 'log.id' }}>
                            <div class="flex items-center justify-between text-xs px-3 py-2 bg-white border border-surface-200 rounded-md">
                                <div class="flex items-center gap-3 flex-1 min-w-0">
                                    <span x-text="new Date(log.sendAt).toLocaleString()" class="text-ink-500 font-mono text-[10px]" />
                                    <span x-text="log.recipientEmail" class="text-ink-700 truncate" />
                                </div>
                                <span x-bind:class="statusClass(log.status)" class="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full" x-text="log.status" />
                            </div>
                        </template>
                    </div>
                </section>

                <script src="/js/auth.js" />
                <script src="/js/automations.js" />
                <script src="/js/attention-rules.js" />
            </div>
        </SettingsLayout>
    );
}
