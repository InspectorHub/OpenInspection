import { SettingsLayout } from '../components/settings-layout';
import type { BrandingConfig } from '../../types/auth';

interface Props {
    branding?: BrandingConfig | undefined;
    /**
     * Booking #7 Sprint A — current value of users.slug for the signed-in
     * inspector. `null` when they haven't picked one yet, in which case the
     * slug card renders an empty input + a helper hint instead of the live
     * booking-link preview.
     */
    currentSlug?: string | null;
    /**
     * Booking #7 Sprint A — used to render the booking-link preview as
     * `<subdomain>.inspectorhub.io/book/<slug>`. The route handler resolves
     * this from the tenants table on the request path.
     */
    tenantSubdomain?: string;
    /**
     * Sprint B-4b — signed-in user's identity card (name + contact + license)
     * passed to the "My email signature" preview card. The card is omitted
     * when this is missing OR when currentSlug is null (signature has no
     * rebooking link without a slug).
     */
    currentUser?: {
        name?: string | null;
        email?: string | null;
        phone?: string | null;
        licenseNumber?: string | null;
    } | null;
    /**
     * Booking #7 Sprint C-1 — public-profile editable fields (bio, photo,
     * service areas). Optional so a brand-new user without saved values still
     * gets a usable editor. Service areas accept up to 20 entries; the
     * service-side route enforces the same cap.
     */
    currentProfile?: {
        bio?: string | null;
        photoUrl?: string | null;
        serviceAreas?: Array<{ city: string; state: string; zip: string }>;
    } | null;
}

/**
 * Settings → Profile
 * Inspector identity (name / phone / license #) plus — Booking #7 Sprint A —
 * the per-inspector booking slug card. The slug input wires into
 * `/api/public/check/slug` for live availability and posts to
 * `/api/profile/slug` to save.
 */
export const SettingsProfilePage = ({ branding, currentSlug, tenantSubdomain, currentUser, currentProfile }: Props): JSX.Element => {
    const slug = currentSlug ?? null;
    const subdomain = tenantSubdomain ?? '';
    // PR 2 — uniform path-tenant booking URL shape: `<host>/book/<tenant>/<slug>`.
    const sigHost = branding?.bookingHost || 'inspectorhub.io';
    const bookingLink = slug && subdomain
        ? `${sigHost}/book/${subdomain}/${slug}`
        : null;
    // Sprint B-4b — signature card data. Only renders when the user has a
    // slug (no rebooking link to point at otherwise).
    const showSignatureCard = !!slug && !!sigHost && !!subdomain;
    // Sprint C-1 — public profile section state.
    const profileBio = currentProfile?.bio ?? '';
    const profilePhotoUrl = currentProfile?.photoUrl ?? '';
    const profileAreas = currentProfile?.serviceAreas ?? [];
    const profileAreasJson = JSON.stringify(profileAreas);
    return (
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

            {/* Booking #7 Sprint A — booking slug card. */}
            <section class="bg-white rounded-lg border border-surface-200 p-6 space-y-6 mt-6">
                <header class="space-y-1">
                    <h3 class="text-[11px] font-bold text-ink-500 uppercase tracking-[0.2em]">Booking link</h3>
                    <p class="text-xs text-ink-500">
                        Customers visit this URL to book inspections directly with you.
                    </p>
                </header>

                <label class="block">
                    <span class="block text-[13px] font-semibold text-ink-900 mb-1">Slug</span>
                    <input
                        type="text"
                        id="profileSlug"
                        name="slug"
                        data-testid="settings-slug-input"
                        value={slug ?? ''}
                        data-current-slug={slug ?? ''}
                        placeholder="your-public-username"
                        autocomplete="off"
                        class="block w-full rounded-md border border-surface-200 px-3 py-2 text-sm focus:border-blueprint-500 focus:ring-2 focus:ring-blueprint-200 outline-none transition-colors"
                    />
                    <p
                        id="profileSlugStatus"
                        data-testid="settings-slug-status"
                        class="mt-1 text-xs text-ink-500"
                    >Lowercase letters, numbers, and hyphens (3-32 chars).</p>
                </label>

                {bookingLink ? (
                    <div class="rounded-md bg-surface-50 px-4 py-3 flex items-center justify-between gap-3">
                        <div class="min-w-0">
                            <p class="text-xs uppercase tracking-wider text-ink-500 mb-1">Your booking link</p>
                            <code
                                data-testid="settings-slug-link"
                                class="text-sm font-mono text-ink-900 break-all"
                            >{bookingLink}</code>
                        </div>
                        <button
                            type="button"
                            id="profileSlugCopy"
                            data-testid="settings-slug-copy"
                            class="text-xs font-semibold text-blueprint-600 hover:underline whitespace-nowrap"
                        >Copy</button>
                    </div>
                ) : (
                    <p data-testid="settings-slug-empty-hint" class="text-xs text-ink-500">
                        Customers visit this URL to book inspections directly with you. Pick a slug to publish your booking page.
                    </p>
                )}

                <div class="flex justify-end pt-2 border-t border-surface-200">
                    <button
                        type="button"
                        id="saveProfileSlugBtn"
                        class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all disabled:bg-surface-200 disabled:cursor-not-allowed"
                    >Save Slug</button>
                </div>

                {/* Booking #7 Sprint A — confirmation modal for changing an
                    already-set slug. Opens via JS only when the user has a
                    saved slug and is changing it (not on first set). */}
                <dialog
                    id="profileSlugConfirm"
                    data-testid="settings-slug-confirm-modal"
                    class="rounded-lg p-0 backdrop:bg-ink-900/40 max-w-md w-full"
                >
                    <div class="p-6 space-y-3">
                        <h4 class="text-base font-bold text-ink-900">Change your booking slug?</h4>
                        <p class="text-sm text-ink-700">
                            Any link to your old slug — for example a card you handed a client or a text message to a lead — will stop working. The new link will be the only way customers can book with you.
                        </p>
                        <p
                            id="profileSlugConfirmDiff"
                            data-testid="settings-slug-confirm-diff"
                            class="text-xs font-mono text-ink-500"
                        ></p>
                        <div class="flex justify-end gap-2 pt-2">
                            <button
                                type="button"
                                id="profileSlugConfirmCancel"
                                data-testid="settings-slug-confirm-cancel"
                                class="px-3 py-2 text-sm rounded-md border border-surface-200 hover:bg-surface-50"
                            >Keep current slug</button>
                            <button
                                type="button"
                                id="profileSlugConfirmYes"
                                data-testid="settings-slug-confirm-yes"
                                class="px-3 py-2 text-sm rounded-md bg-rose-600 text-white font-bold hover:bg-rose-700"
                            >Yes, change it</button>
                        </div>
                    </div>
                </dialog>
            </section>

            {/* Booking #7 Sprint C-1 — Public profile editor.
                Bio + service areas POST to /api/profile/details.
                Photo POSTs multipart to /api/profile/photo. */}
            <section
                data-testid="settings-profile-public-card"
                class="bg-white rounded-lg border border-surface-200 p-6 space-y-6 mt-6"
            >
                <header class="space-y-1">
                    <h3 class="text-[11px] font-bold text-ink-500 uppercase tracking-[0.2em]">Public profile</h3>
                    <p class="text-xs text-ink-500">
                        Photo, bio, and service areas appear on your <code class="font-mono text-ink-700">/inspector/{slug ?? 'your-slug'}</code> page.
                    </p>
                </header>

                {/* Photo uploader */}
                <div
                    data-testid="settings-profile-photo-uploader"
                    class="space-y-2"
                >
                    <label class="block text-[13px] font-semibold text-ink-900">Profile photo</label>
                    <div class="flex items-center gap-4">
                        <div
                            id="profilePhotoPreview"
                            data-testid="settings-profile-photo-preview"
                            data-photo-url={profilePhotoUrl}
                            class="w-24 h-24 rounded-full bg-surface-100 border border-surface-200 overflow-hidden flex items-center justify-center text-ink-400 text-xs"
                        >
                            {profilePhotoUrl ? (
                                <img src={profilePhotoUrl} alt="Current profile photo" class="w-full h-full object-cover" />
                            ) : (
                                <span>No photo</span>
                            )}
                        </div>
                        <div class="space-y-2">
                            <input
                                type="file"
                                id="profilePhotoFile"
                                data-testid="settings-profile-photo-file"
                                accept="image/jpeg,image/png,image/webp"
                                class="block text-xs"
                            />
                            <p class="text-[11px] text-ink-500">JPG, PNG, or WebP. Max 2MB. Square crop renders best.</p>
                        </div>
                    </div>
                </div>

                {/* Bio */}
                <div class="space-y-2">
                    <label for="profileBio" class="block text-[13px] font-semibold text-ink-900">Bio</label>
                    <textarea
                        id="profileBio"
                        data-testid="settings-profile-bio"
                        rows={4}
                        maxlength={600}
                        placeholder="Tell customers a bit about your background, certifications, and inspection style."
                        class="block w-full rounded-md border border-surface-200 px-3 py-2 text-sm focus:border-blueprint-500 focus:ring-2 focus:ring-blueprint-200 outline-none transition-colors"
                    >{profileBio}</textarea>
                    <p
                        id="profileBioCounter"
                        data-testid="settings-profile-bio-counter"
                        class="text-[11px] text-ink-500"
                    >{profileBio.length} / 600</p>
                </div>

                {/* Service areas editor */}
                <div
                    data-testid="settings-profile-areas-editor"
                    class="space-y-2"
                    data-initial-areas={profileAreasJson}
                >
                    <label class="block text-[13px] font-semibold text-ink-900">Service areas</label>
                    <p class="text-[11px] text-ink-500">Cities you regularly serve. Up to 20 entries.</p>
                    <div id="profileAreasList" class="space-y-2">
                        {profileAreas.map((a, i) => (
                            <div class="flex gap-2 items-center" data-testid="settings-profile-area-row" data-area-index={i}>
                                <input
                                    type="text"
                                    placeholder="City"
                                    value={a.city}
                                    data-area-field="city"
                                    class="flex-1 rounded-md border border-surface-200 px-3 py-2 text-sm"
                                />
                                <input
                                    type="text"
                                    placeholder="State"
                                    value={a.state}
                                    maxlength={4}
                                    data-area-field="state"
                                    class="w-20 rounded-md border border-surface-200 px-3 py-2 text-sm uppercase"
                                />
                                <input
                                    type="text"
                                    placeholder="ZIP"
                                    value={a.zip}
                                    maxlength={10}
                                    data-area-field="zip"
                                    class="w-24 rounded-md border border-surface-200 px-3 py-2 text-sm"
                                />
                                <button
                                    type="button"
                                    data-testid="settings-profile-area-remove"
                                    class="text-xs text-rose-600 hover:underline"
                                    data-area-action="remove"
                                >Remove</button>
                            </div>
                        ))}
                    </div>
                    <button
                        type="button"
                        id="profileAreaAdd"
                        data-testid="settings-profile-area-add"
                        class="text-xs font-semibold text-blueprint-600 hover:underline"
                    >+ Add area</button>
                </div>

                <div class="flex justify-end pt-2 border-t border-surface-200">
                    <button
                        type="button"
                        id="saveProfilePublicBtn"
                        data-testid="settings-profile-public-save"
                        class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all disabled:bg-surface-200 disabled:cursor-not-allowed"
                    >Save Profile</button>
                </div>
            </section>

            {/* Sprint B-4b — My email signature card. Renders only when the
                user has a slug (otherwise the rebooking-link line is empty
                and the card has nothing inspector-specific to preview). */}
            {showSignatureCard && (
                <section
                    data-testid="settings-signature-card"
                    class="bg-white rounded-lg border border-surface-200 p-6 space-y-4 mt-6"
                    data-sig-name={currentUser?.name ?? ''}
                    data-sig-email={currentUser?.email ?? ''}
                    data-sig-phone={currentUser?.phone ?? ''}
                    data-sig-license={currentUser?.licenseNumber ?? ''}
                    data-sig-slug={slug ?? ''}
                    data-sig-host={sigHost}
                    data-sig-tenant={subdomain}
                >
                    <header class="space-y-1">
                        <h3 class="text-[11px] font-bold text-ink-500 uppercase tracking-[0.2em]">My email signature</h3>
                        <p class="text-xs text-ink-500">
                            Paste this into Outlook, Gmail, or Apple Mail signature settings so customers can rebook with you from any email you send.
                        </p>
                    </header>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="space-y-2">
                            <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-500">HTML</p>
                            <pre
                                data-testid="settings-signature-html-preview"
                                id="profileSignatureHtmlPreview"
                                class="text-xs bg-surface-50 rounded-md p-3 max-h-40 overflow-auto whitespace-pre-wrap break-all"
                            ><code></code></pre>
                            <button
                                type="button"
                                id="profileSignatureCopyHtml"
                                data-testid="settings-signature-copy-html"
                                class="text-xs font-semibold text-blueprint-600 hover:underline"
                            >Copy HTML</button>
                        </div>
                        <div class="space-y-2">
                            <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-500">Plain text</p>
                            <pre
                                data-testid="settings-signature-text-preview"
                                id="profileSignatureTextPreview"
                                class="text-xs bg-surface-50 rounded-md p-3 max-h-40 overflow-auto whitespace-pre"
                            ><code></code></pre>
                            <button
                                type="button"
                                id="profileSignatureCopyText"
                                data-testid="settings-signature-copy-text"
                                class="text-xs font-semibold text-blueprint-600 hover:underline"
                            >Copy text</button>
                        </div>
                    </div>
                </section>
            )}

            <script src="/js/auth.js"></script>
            <script src="/js/settings.js"></script>
            <script src="/js/settings-profile-slug.js"></script>
            <script src="/js/settings-profile-signature.js"></script>
            <script src="/js/settings-profile-photo.js"></script>
            <script src="/js/settings-profile-public.js"></script>
        </SettingsLayout>
    );
};
