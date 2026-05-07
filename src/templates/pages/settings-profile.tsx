import { SettingsLayout } from '../components/settings-layout';
import type { BrandingConfig } from '../../types/auth';

interface Props { branding?: BrandingConfig | undefined; }

/**
 * Settings → Profile
 * Inspector identity (name / phone / license #). Behavior unchanged from the old
 * `sec-profile` block on `/settings`: same field IDs (#profileName, #profilePhone,
 * #profileLicense) and same `saveProfile()` handler from `/js/settings.js`.
 */
export const SettingsProfilePage = ({ branding }: Props): JSX.Element => (
    <SettingsLayout
        branding={branding}
        title="Settings | Profile"
        group="profile"
        subPage="profile"
        pageTitle="Profile"
        pageSubtitle="Inspector identity that appears on every report you generate."
    >
        <section class="bg-white rounded-lg border border-surface-200 p-6 space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div class="space-y-2">
                    <label for="profileName" class="block text-xs font-bold text-ink-700 uppercase tracking-[0.2em]">Full Name</label>
                    <input type="text" id="profileName" placeholder="John Smith"
                        class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none transition-all font-medium text-sm placeholder:text-ink-300" />
                    <p class="text-[11px] text-ink-500">Displayed on inspection reports.</p>
                </div>
                <div class="space-y-2">
                    <label for="profilePhone" class="block text-xs font-bold text-ink-700 uppercase tracking-[0.2em]">Phone</label>
                    <input type="tel" id="profilePhone" placeholder="(555) 123-4567"
                        class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none transition-all font-medium text-sm placeholder:text-ink-300" />
                </div>
                <div class="space-y-2">
                    <label for="profileLicense" class="block text-xs font-bold text-ink-700 uppercase tracking-[0.2em]">License #</label>
                    <input type="text" id="profileLicense" placeholder="HI-12345"
                        class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none transition-all font-medium text-sm placeholder:text-ink-300" />
                    <p class="text-[11px] text-ink-500">State inspector license number.</p>
                </div>
            </div>

            <div class="flex justify-end pt-2 border-t border-surface-200">
                <button onclick="saveProfile()" id="saveProfileBtn"
                    class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all disabled:bg-surface-200 disabled:cursor-not-allowed">
                    Save Profile
                </button>
            </div>
        </section>

        <script src="/js/auth.js"></script>
        <script src="/js/settings.js"></script>
    </SettingsLayout>
);
