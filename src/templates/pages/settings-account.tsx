import { SettingsLayout } from '../components/settings-layout';
import type { BrandingConfig } from '../../types/auth';

interface Props { branding?: BrandingConfig | undefined; }

type AccountSubPage = 'password' | 'bot-protection';

/* ─────────────────────────────  Password  ───────────────────────────── */

export const SettingsAccountPasswordPage = ({ branding }: Props): JSX.Element => (
    <SettingsLayout
        branding={branding}
        title="Settings | Change Password"
        group="account"
        subPage="password"
        pageTitle="Change Password"
        pageSubtitle="Update the password used to sign in to your dashboard."
    >
        <section class="bg-white rounded-lg border border-surface-200 p-6 space-y-5">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div class="space-y-2">
                    <label for="currentPassword" class="block text-xs font-bold text-ink-700 uppercase tracking-[0.2em]">Current Password</label>
                    <input type="password" id="currentPassword" autocomplete="current-password"
                        class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none transition-all font-medium text-sm" />
                </div>
                <div class="space-y-2">
                    <label for="newPassword" class="block text-xs font-bold text-ink-700 uppercase tracking-[0.2em]">New Password</label>
                    <input type="password" id="newPassword" autocomplete="new-password"
                        class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none transition-all font-medium text-sm" />
                </div>
                <div class="space-y-2">
                    <label for="confirmPassword" class="block text-xs font-bold text-ink-700 uppercase tracking-[0.2em]">Confirm New Password</label>
                    <input type="password" id="confirmPassword" autocomplete="new-password"
                        class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none transition-all font-medium text-sm" />
                </div>
            </div>
            <div class="flex justify-end pt-2 border-t border-surface-200">
                <button onclick="changePassword()"
                    class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all">
                    Update Password
                </button>
            </div>
        </section>
        <script src="/js/auth.js"></script>
        <script src="/js/settings.js"></script>
    </SettingsLayout>
);

/* ─────────────────────────────  Bot Protection  ───────────────────────────── */

export const SettingsAccountBotProtectionPage = ({ branding }: Props): JSX.Element => (
    <SettingsLayout
        branding={branding}
        title="Settings | Bot Protection"
        group="account"
        subPage="bot-protection"
        pageTitle="Bot Protection"
        pageSubtitle="Cloudflare Turnstile keys for the public booking form. Site key is public; secret key is stored encrypted."
    >
        <section class="bg-white rounded-lg border border-surface-200 p-6 space-y-5">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div class="space-y-2">
                    <label for="turnstileSiteKey" class="block text-xs font-bold text-ink-700 uppercase tracking-[0.2em]">Site Key <span class="text-ink-400 normal-case font-normal">(public)</span></label>
                    <input type="text" id="turnstileSiteKey" placeholder="0x4AAAA..."
                        class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none transition-all font-medium text-sm placeholder:text-ink-300" />
                </div>
                <div class="space-y-2">
                    <label for="turnstileSecretKey" class="block text-xs font-bold text-ink-700 uppercase tracking-[0.2em]">Secret Key <span class="text-ink-400 normal-case font-normal">(encrypted)</span></label>
                    <input type="password" id="turnstileSecretKey" placeholder="••••••••"
                        class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none transition-all font-medium text-sm placeholder:text-ink-300" autocomplete="off" />
                </div>
            </div>
            <div class="flex justify-end pt-2 border-t border-surface-200">
                <button onclick="saveSecrets('turnstile')"
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
export const SettingsAccountPage = ({ branding, subPage }: Props & { subPage: AccountSubPage }): JSX.Element => {
    if (subPage === 'bot-protection') return SettingsAccountBotProtectionPage({ branding });
    return SettingsAccountPasswordPage({ branding });
};
