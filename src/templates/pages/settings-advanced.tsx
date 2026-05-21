import { SettingsLayout } from '../components/settings-layout';
import type { BrandingConfig } from '../../types/auth';

interface Props { branding?: BrandingConfig | undefined; }

type AdvancedSubPage = 'payments' | 'ai';

/* ─────────────────────────────  Payments (Stripe Connect)  ───────────────────────────── */

export const SettingsAdvancedPaymentsPage = ({ branding }: Props): JSX.Element => (
    <SettingsLayout
        branding={branding}
        title="Settings | Payments"
        group="advanced"
        subPage="payments"
        pageTitle="Payments (Stripe Connect)"
        pageSubtitle="Accept card payments on invoices via your Stripe Express account."
    >
        <section class="bg-white rounded-lg border border-surface-200 p-6 space-y-5" x-data="stripeConnectPanel()" x-init="load()">
            <div class="flex items-center gap-2">
                <span x-show="connected" class="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Connected</span>
                <span x-show="!connected" class="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-surface-100 text-ink-500">Not connected</span>
            </div>
            <p class="text-sm text-ink-600">
                Create your Stripe Express account at
                <a href="https://dashboard.stripe.com/connect/express" target="_blank" rel="noopener" class="text-blueprint-700 hover:underline"> dashboard.stripe.com/connect/express</a>,
                then paste the account ID (starts with <code class="font-mono">acct_</code>) below.
            </p>
            <div x-show="!connected" class="space-y-3">
                <label class="block text-xs font-bold text-ink-700 uppercase tracking-[0.2em]">Stripe account ID</label>
                <input type="text" x-model="accountInput" name="stripe-account-id" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck={false} placeholder="acct_1AbCdEfGhIjKlMnO" class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none transition-all font-mono text-sm placeholder:text-ink-300" />
                <button type="button" x-on:click="save()" x-bind:disabled="saving" class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all disabled:bg-surface-200 disabled:cursor-not-allowed">Connect Account</button>
            </div>
            <div x-show="connected" class="text-sm text-ink-700 space-y-3">
                <div>Connected account: <code class="font-mono text-xs px-2 py-1 rounded bg-surface-100" x-text="accountId"></code></div>
                <button type="button" x-on:click="disconnect()" class="px-4 py-2 rounded-md border border-rose-200 text-rose-700 text-sm font-bold hover:bg-rose-50 transition-all">Disconnect</button>
            </div>
        </section>
        <script src="/js/auth.js"></script>
        <script src="/js/settings.js"></script>
    </SettingsLayout>
);

/* ─────────────────────────────  AI  ───────────────────────────── */

export const SettingsAdvancedAIPage = ({ branding }: Props): JSX.Element => (
    <SettingsLayout
        branding={branding}
        title="Settings | AI"
        group="advanced"
        subPage="ai"
        pageTitle="AI features"
        pageSubtitle="Google Gemini powers comment assist and inspection summaries. Get a key at aistudio.google.com."
    >
        <section class="bg-white rounded-lg border border-surface-200 p-6 space-y-5">
            <div class="space-y-2 max-w-xl">
                <label for="geminiApiKey" class="block text-xs font-bold text-ink-700 uppercase tracking-[0.2em]">Gemini API Key</label>
                <input type="password" id="geminiApiKey" placeholder="AIza••••••••"
                    class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none transition-all font-medium text-sm placeholder:text-ink-300" autocomplete="off" />
                <p class="text-[11px] text-ink-500">Stored encrypted. Get a key at <span class="text-ink-700">aistudio.google.com</span>.</p>
            </div>
            <div class="flex justify-end pt-2 border-t border-surface-200">
                <button onclick="saveSecrets('ai')"
                    class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all">
                    Save
                </button>
            </div>
        </section>
        <script src="/js/auth.js"></script>
        <script src="/js/settings.js"></script>
    </SettingsLayout>
);

/**
 * Dispatcher used by the route handler.
 */
export const SettingsAdvancedPage = ({ branding, subPage }: Props & { subPage: AdvancedSubPage }): JSX.Element => {
    if (subPage === 'ai') return SettingsAdvancedAIPage({ branding });
    return SettingsAdvancedPaymentsPage({ branding });
};
