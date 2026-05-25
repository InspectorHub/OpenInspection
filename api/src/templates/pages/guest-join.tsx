/**
 * Design System 0520 subsystem C phase 6 — anonymous guest join landing.
 *
 * Distinct from `JoinPage` (team-member finalisation, which only needs a
 * password since the draft user row already exists). Guests submit
 * name + email + password to `POST /api/guest/claim`, which creates the
 * user row, sets `expires_at`, and counts against `tenants.max_users`.
 */
import { BareLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';

export const GuestJoinPage = (
    { token, branding }: { token?: string; branding?: BrandingConfig | undefined } = {},
): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    return (
        <BareLayout title={`Join ${siteName} as guest`} branding={branding}>
            <div class="min-h-screen flex items-center justify-center p-6 bg-slate-50">
                <div class="w-full max-w-md">
                    <div class="glass-panel p-6 rounded-xl shadow-lg">
                        <div class="text-center mb-6">
                            <h1 class="ih-h1 mb-2">Join the team</h1>
                            <p class="ih-meta">You were invited to collaborate on {siteName}.</p>
                        </div>

                        <form id="guestJoinForm" class="space-y-4">
                            <input type="hidden" id="token" name="token" value={token || ''} />

                            <div class="space-y-2">
                                <label for="name" class="ih-eyebrow ml-1">Your name</label>
                                <input id="name" name="name" type="text" required maxlength={100}
                                    class="ih-input w-full" placeholder="Jane Doe" />
                            </div>

                            <div class="space-y-2">
                                <label for="email" class="ih-eyebrow ml-1">Email</label>
                                <input id="email" name="email" type="email" required maxlength={128}
                                    class="ih-input w-full" placeholder="you@company.com" />
                            </div>

                            <div class="space-y-2">
                                <label for="password" class="ih-eyebrow ml-1">Create a password</label>
                                <input id="password" name="password" type="password" required minlength={8} maxlength={128}
                                    autocomplete="new-password"
                                    class="ih-input w-full" placeholder="At least 8 characters" />
                            </div>

                            <button type="submit" id="submitBtn"
                                class="ih-btn ih-btn--primary w-full">
                                Accept invitation
                            </button>
                        </form>

                        <div id="guestJoinError"
                            class="mt-6 text-center text-xs font-bold text-rose-600 uppercase tracking-widest hidden"></div>
                    </div>
                </div>
            </div>
            <script src="/js/guest-join.js"></script>
        </BareLayout>
    );
};
