import { SettingsLayout } from '../components/settings-layout';
import type { BrandingConfig } from '../../types/auth';

interface Props { branding?: BrandingConfig | undefined; }

type CommSubPage = 'email' | 'calendar' | 'integrations';

/* ─────────────────────────────  Email  ───────────────────────────── */

export const SettingsCommunicationEmailPage = ({ branding }: Props): JSX.Element => (
    <SettingsLayout
        branding={branding}
        title="Settings | Email"
        group="communication"
        subPage="email"
        pageTitle="Email delivery"
        pageSubtitle="Resend is used for password resets, invitations, and report delivery. Domain must be verified in Resend."
    >
        <section class="bg-white rounded-lg border border-surface-200 p-6 space-y-5">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div class="space-y-2">
                    <label for="senderEmail" class="block text-xs font-bold text-ink-700 uppercase tracking-[0.2em]">Sender Email</label>
                    <input type="email" id="senderEmail" placeholder="Reports &lt;reports@yourdomain.com&gt;"
                        class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none transition-all font-medium text-sm placeholder:text-ink-300" />
                    <p class="text-[11px] text-ink-500">Used as "From" address. Domain must be verified in Resend.</p>
                </div>
                <div class="space-y-2">
                    <label for="resendApiKey" class="block text-xs font-bold text-ink-700 uppercase tracking-[0.2em]">Resend API Key</label>
                    <input type="password" id="resendApiKey" placeholder="re_••••••••"
                        class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none transition-all font-medium text-sm placeholder:text-ink-300" autocomplete="off" />
                    <p class="text-[11px] text-ink-500">Stored encrypted. Leave blank to keep existing key.</p>
                </div>
            </div>
            <div class="flex justify-end pt-2 border-t border-surface-200">
                <button onclick="saveSecrets('email')"
                    class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all">
                    Save
                </button>
            </div>
        </section>
        <script src="/js/auth.js"></script>
        <script src="/js/settings.js"></script>
    </SettingsLayout>
);

/* ─────────────────────────────  Calendar (ICS)  ───────────────────────────── */

export const SettingsCommunicationCalendarPage = ({ branding }: Props): JSX.Element => (
    <SettingsLayout
        branding={branding}
        title="Settings | Apple Calendar"
        group="communication"
        subPage="calendar"
        pageTitle="Apple Calendar"
        pageSubtitle="Subscribe to your inspections in Apple Calendar, Google Calendar, or any app that supports ICS feeds. Read-only."
    >
        <section class="bg-white rounded-lg border border-surface-200 p-6 space-y-5">
            <div class="flex flex-col sm:flex-row gap-3">
                <input id="icsUrl" type="text" readonly
                    class="flex-1 px-3 py-2 rounded-md border border-surface-200 bg-surface-50 text-ink-700 font-mono text-xs"
                    placeholder="Loading subscription URL..." />
                <button onclick="copyIcsUrl()" id="copyIcsBtn"
                    class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all">
                    Copy Link
                </button>
            </div>
            <p class="text-[11px] text-ink-500">In Apple Calendar: File → New Calendar Subscription → paste URL.</p>
        </section>
        <script src="/js/auth.js"></script>
        <script src="/js/settings.js"></script>
    </SettingsLayout>
);

/* ─────────────────────────────  Integrations  ───────────────────────────── */

export const SettingsCommunicationIntegrationsPage = ({ branding }: Props): JSX.Element => (
    <SettingsLayout
        branding={branding}
        title="Settings | Integrations"
        group="communication"
        subPage="integrations"
        pageTitle="Integrations"
        pageSubtitle="Public app URL (used for OAuth redirects + email links) and Google Calendar OAuth credentials."
    >
        <section class="bg-white rounded-lg border border-surface-200 p-6 space-y-5">
            <div class="space-y-2">
                <label for="appBaseUrl" class="block text-xs font-bold text-ink-700 uppercase tracking-[0.2em]">App Base URL</label>
                <input type="url" id="appBaseUrl" placeholder="https://inspect.yourdomain.com"
                    class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none transition-all font-medium text-sm placeholder:text-ink-300" />
                <p class="text-[11px] text-ink-500">Used for OAuth redirect URIs and email links.</p>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div class="space-y-2">
                    <label for="googleClientId" class="block text-xs font-bold text-ink-700 uppercase tracking-[0.2em]">Google Client ID <span class="text-ink-400 normal-case font-normal">(public)</span></label>
                    <input type="text" id="googleClientId" placeholder="00000000-xxxx.apps.googleusercontent.com"
                        class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none transition-all font-medium text-sm placeholder:text-ink-300" />
                </div>
                <div class="space-y-2">
                    <label for="googleClientSecret" class="block text-xs font-bold text-ink-700 uppercase tracking-[0.2em]">Google Client Secret <span class="text-ink-400 normal-case font-normal">(encrypted)</span></label>
                    <input type="password" id="googleClientSecret" placeholder="GOCSP••••••••"
                        class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none transition-all font-medium text-sm placeholder:text-ink-300" autocomplete="off" />
                </div>
            </div>
            <div class="flex justify-end pt-2 border-t border-surface-200">
                <button onclick="saveIntegration()"
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
export const SettingsCommunicationPage = ({ branding, subPage }: Props & { subPage: CommSubPage }): JSX.Element => {
    if (subPage === 'calendar') return SettingsCommunicationCalendarPage({ branding });
    if (subPage === 'integrations') return SettingsCommunicationIntegrationsPage({ branding });
    return SettingsCommunicationEmailPage({ branding });
};
