import { SettingsLayout } from '../components/settings-layout';
import { BrandingConfig } from '../../types/auth';

interface Props {
    branding?: BrandingConfig;
    /** Sprint C-4 — current user's slug used for the per-inspector iframe
     *  snippet generator. Null when no slug saved yet. */
    currentUserSlug?: string | null;
    /** Sprint C-4 — bookingHost ("acme.inspectorhub.io") for the snippet src URL. */
    bookingHost?: string;
    /** PR 2 — tenant subdomain (path segment) for path-tenant embed URLs. */
    tenantSubdomain?: string | null;
}

export const SettingsWidgetPage = ({ branding, currentUserSlug, bookingHost, tenantSubdomain }: Props) => (
    <SettingsLayout
        branding={branding}
        title="Settings | Embed booking widget"
        group="catalog"
        subPage="widget"
        pageTitle="Embed booking widget"
        pageSubtitle="Paste a snippet on your marketing site. Bookings flow into your inspections list."
    >
        <div class="space-y-5 max-w-3xl">
            <section class="bg-white border border-surface-200 rounded-lg p-6 space-y-4">
                <div>
                    <h2 class="text-sm font-bold text-ink-900 uppercase tracking-[0.2em]">1 · Allowed Origins</h2>
                    <p class="text-xs text-ink-500 mt-1">List the domains where you'll embed the widget. One per line. Use <code class="font-mono">{'https://*.example.com'}</code> for wildcard subdomains.</p>
                </div>
                <textarea id="widgetOrigins" rows={6}
                    class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none transition-all font-mono text-sm placeholder:text-ink-300"
                    placeholder={'https://www.acmeinspections.com\nhttps://*.acmeinspections.com'}></textarea>
                <div class="flex justify-end">
                    <button id="saveOriginsBtn" class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all">Save Origins</button>
                </div>
            </section>

            <section class="bg-white border border-surface-200 rounded-lg p-6 space-y-4">
                <h2 class="text-sm font-bold text-ink-900 uppercase tracking-[0.2em]">2 · Style</h2>
                <div class="flex gap-2 flex-wrap">
                    <button class="widget-style-btn px-3 py-2 rounded-md border-2 border-surface-200 font-bold text-sm hover:border-blueprint-200 transition-colors" data-style="light">☀ Light</button>
                    <button class="widget-style-btn px-3 py-2 rounded-md border-2 border-surface-200 font-bold text-sm hover:border-blueprint-200 transition-colors" data-style="dark">🌙 Dark</button>
                    <button class="widget-style-btn px-3 py-2 rounded-md border-2 border-surface-200 font-bold text-sm hover:border-blueprint-200 transition-colors" data-style="branded">🎨 Branded</button>
                </div>
            </section>

            <section class="bg-white border border-surface-200 rounded-lg p-6 space-y-4">
                <div>
                    <h2 class="text-sm font-bold text-ink-900 uppercase tracking-[0.2em]">3 · Snippet</h2>
                    <p class="text-xs text-ink-500 mt-1">Copy and paste this into your site where the booking form should appear.</p>
                </div>
                <pre id="widgetSnippet" class="bg-ink-900 text-emerald-300 p-4 rounded-md overflow-x-auto text-xs font-mono"></pre>
                <div class="flex justify-end">
                    <button id="copySnippetBtn" class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all">Copy Snippet</button>
                </div>
            </section>

            <section class="bg-white border border-surface-200 rounded-lg p-6 space-y-4">
                <h2 class="text-sm font-bold text-ink-900 uppercase tracking-[0.2em]">4 · Live Preview</h2>
                <iframe id="widgetPreview" class="w-full min-h-[700px] rounded-md border border-surface-200" loading="lazy"></iframe>
            </section>

            {/* Sprint C-4 — per-inspector iframe snippet for /embed/book/<slug>.
                Defaults to width:100% (host page caps as it sees fit) per the
                frontend-design directive. Compact variant collapses to a single
                CTA expandable on click. */}
            {currentUserSlug && bookingHost && tenantSubdomain && (
                <section
                    data-testid="settings-widget-personal-snippet"
                    data-slug={currentUserSlug}
                    data-host={bookingHost}
                    data-tenant={tenantSubdomain}
                    class="bg-white border border-surface-200 rounded-lg p-6 space-y-4"
                >
                    <div>
                        <h2 class="text-sm font-bold text-ink-900 uppercase tracking-[0.2em]">5 · Personal iframe snippet</h2>
                        <p class="text-xs text-ink-500 mt-1">A direct iframe to your <code class="font-mono">/embed/book/{tenantSubdomain}/{currentUserSlug}</code> page. Pastes anywhere, no JS bundle required.</p>
                    </div>

                    <label class="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            id="personalSnippetCompact"
                            data-testid="settings-widget-compact-toggle"
                            class="rounded border-surface-300"
                        />
                        <span>Compact variant (single CTA, expands on click)</span>
                    </label>

                    <pre
                        id="personalSnippet"
                        data-testid="settings-widget-personal-snippet-code"
                        class="bg-ink-900 text-emerald-300 p-4 rounded-md overflow-x-auto text-xs font-mono whitespace-pre-wrap break-all"
                    ></pre>
                    <div class="flex justify-end">
                        <button
                            type="button"
                            id="copyPersonalSnippetBtn"
                            data-testid="settings-widget-copy-snippet"
                            class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all"
                        >Copy snippet</button>
                    </div>
                </section>
            )}

            <script src="/js/auth.js"></script>
            <script src="/js/toast.js"></script>
            <script src="/js/settings-widget.js"></script>
            <script src="/js/settings-widget-personal.js"></script>
        </div>
    </SettingsLayout>
);
