import { BrandingConfig } from '../../types/auth';
import { NetworkPill } from '../components/network-pill';
import { ConflictModal } from '../components/conflict-modal';
import { KeyboardHUD } from '../components/keyboard-hud';
import { CommandPalette } from '../components/command-palette';
import { InlineTextPopover } from '../components/inline-text-popover';

function sanitizePrimaryColor(branding?: BrandingConfig): string {
    const raw = branding?.primaryColor || '#6366f1';
    return /^#[0-9a-fA-F]{3,8}$/.test(raw) ? raw : '#6366f1';
}

function sanitizeGaId(branding?: BrandingConfig): string {
    const raw = branding?.gaMeasurementId || '';
    return /^G-[A-Z0-9]+$/.test(raw) ? raw : '';
}

function SharedHead({ title, primaryColor, gaMeasurementId, extraHead }: {
    title: string;
    primaryColor: string;
    gaMeasurementId: string;
    extraHead?: JSX.Element;
}): JSX.Element {
    return (
        <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>{title}</title>
            <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
            {/* FOUC prevention: set data-color-scheme before any stylesheet loads. */}
            <script dangerouslySetInnerHTML={{ __html: `(function(){try{var L=localStorage.getItem('ih-color-scheme');if(L&&!localStorage.getItem('oi-color-scheme'))localStorage.setItem('oi-color-scheme',L);if(L)localStorage.removeItem('ih-color-scheme');}catch(e){}var s=localStorage.getItem('oi-color-scheme');var p=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-color-scheme',s==='dark'||(s===null&&p)?'dark':'light');})()`}} />
            <link rel="stylesheet" href="/fonts.css" />
            <link rel="stylesheet" href="/vendor/flatpickr.min.css" />
            {/* Theme toggle runtime — sync load so toggleColorScheme() is available
                before Alpine and DOMContentLoaded fire. */}
            <script src="/js/theme.js"></script>
            {/* hotkeys.js exposes window.OIHotkeys (isTyping/shouldIgnoreSingleChar).
                Loaded synchronously so global keydown handlers see it on first paint. */}
            <script src="/js/hotkeys.js"></script>
            {/* handoff §7 — unsaved-changes guard. Pages opt in by calling
                window.OIDirty.set(true|false). beforeunload + a-click intercept. */}
            <script src="/js/unsaved-guard.js"></script>
            {/* Stub Alpine.data registrations for ESM factories (networkPill,
                conflictModal). The real factories live in /js/network-pill.js
                and /js/conflict-modal.js which are <script type="module">
                (auto-deferred to AFTER alpine.min.js), so without these stubs
                Alpine's first x-data evaluation fires "is not defined" warnings
                for every property referenced inside (online, pendingItems,
                popoverOpen, etc.). registerB4Component in those modules calls
                Alpine.data() again and re-inits trees once the module loads,
                so the stubs are silently replaced by the real factories.
                Loaded SYNC before alpine.min.js so the alpine:init listener
                attaches before Alpine boots. */}
            <script src="/js/alpine-stubs.js"></script>
            <script defer src="/vendor/alpine-collapse.min.js"></script>
            <script defer src="/vendor/alpine.min.js"></script>
            {/* These register Alpine.data factories. Loaded SYNC (no defer)
                so their alpine:init listener attaches BEFORE the deferred
                alpine.min.js fires that event. With defer they ran too late
                and the factories never registered. Factories with no ESM
                imports go here; factories that require ESM imports
                (network-pill, conflict-modal) use the stub pattern above. */}
            <script src="/js/slash-trigger.js"></script>
            <script src="/js/command-palette.js"></script>
            <script src="/js/inline-text-popover.js"></script>
            <script src="/js/template-drift-banner.js"></script>
            <script defer src="/vendor/flatpickr.min.js"></script>
            <script defer src="/js/flatpickr-init.js"></script>
            {/* B4 — Dexie importmap: must precede every type="module" script that imports 'dexie' */}
            <script
                type="importmap"
                dangerouslySetInnerHTML={{ __html: JSON.stringify({
                    imports: { dexie: '/vendor/dexie.mjs' },
                }) }}
            />
            <script type="module" src="/js/network-pill.js"></script>
            <script type="module" src="/js/conflict-modal.js"></script>
            <link rel="stylesheet" href="/styles.css" />
            <style dangerouslySetInnerHTML={{ __html: `
                :root {
                    --primary-color: ${primaryColor};
                    --primary-glow: ${primaryColor}40;
                }
                body { font-family: 'Inter', sans-serif; }
                .glass { background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.3); }
                /* Alpine x-cloak gotcha: Alpine v3 only removes the x-cloak attribute
                   from the x-data root element, not descendants. x-cloak on a nested
                   modal/form combined with this rule keeps it hidden even when
                   x-show=true. Rule: x-cloak only on outermost x-data element; for
                   nested hide-on-load use style=display:none + x-show. See ESLint
                   rule no-restricted-syntax + Spec 4 commits 17a75d7, a753af5. */
                [x-cloak] { display: none !important; }
            ` }} />

            {extraHead}

            {gaMeasurementId && (
                <>
                    <script async src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`}></script>
                    <script dangerouslySetInnerHTML={{ __html: `
                        window.dataLayer = window.dataLayer || [];
                        function gtag(){dataLayer.push(arguments);}
                        gtag('js', new Date());
                        gtag('config', '${gaMeasurementId}');
                    ` }} />
                </>
            )}
        </head>
    );
}

export const BareLayout = (props: { title: string, children: unknown, branding?: BrandingConfig | undefined, extraHead?: JSX.Element, dataTheme?: 'modern' | 'classic' | 'minimal' }): JSX.Element => {
    const { title, children, branding, extraHead, dataTheme } = props;

    return (
        <html lang="en" class="scroll-smooth" {...(dataTheme ? { 'data-theme': dataTheme } : {})}>
            <SharedHead
                title={title}
                primaryColor={sanitizePrimaryColor(branding)}
                gaMeasurementId={sanitizeGaId(branding)}
                {...(extraHead ? { extraHead } : {})}
            />
            <body class="bg-[#fdfdfd] text-slate-900 antialiased min-h-screen selection:bg-indigo-100 selection:text-indigo-900">
                {children}
                {/* Sprint 1 C-3 — NetworkPill is an inspector-only tool;
                    BareLayout serves public-facing pages so the pill renders
                    nothing. Kept in the tree so the layout call signature
                    stays uniform. */}
                <NetworkPill isPublic={true} />
                <ConflictModal />
                <KeyboardHUD />
                <CommandPalette />
                <InlineTextPopover />
                {/* B4 — SW registration. Mirrored from MainLayout so a public
                    visitor who lands on /book or /inspector/<slug> first also
                    gets the offline-capable worker installed. Feature-guarded
                    and .catch(console.warn) so it can't crash the page. */}
                <script dangerouslySetInnerHTML={{ __html: `
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js')
            .catch(function (err) { console.warn('[sw] registration failed', err); });
    });
}
` }} />
            </body>
        </html>
    );
};

export const MainLayout = (props: {
    title: string,
    children: unknown,
    branding?: BrandingConfig | undefined,
    extraHead?: JSX.Element,
    /**
     * Sprint B-1 — explicit overrides for the ⌘K booking action; when not
     * passed, the layout falls back to branding.currentUserSlug /
     * branding.bookingHost (set by inspectorPaletteMiddleware).
     */
    currentUserSlug?: string | null,
    bookingHost?: string,
}): JSX.Element => {
    const { title, children, branding, extraHead } = props;
    const siteName = branding?.siteName || 'OpenInspection';
    const logoUrl = branding?.logoUrl;
    // Sprint B-1 — palette context falls back to the value the middleware
    // hydrated into branding so individual pages don't need to plumb it.
    const paletteSlug = props.currentUserSlug !== undefined ? props.currentUserSlug : (branding?.currentUserSlug ?? null);
    const paletteHost = props.bookingHost !== undefined ? props.bookingHost : (branding?.bookingHost ?? '');
    const paletteTenant = branding?.tenantSubdomain ?? null;

    return (
        <html lang="en" class="scroll-smooth">
            <SharedHead
                title={title}
                primaryColor={sanitizePrimaryColor(branding)}
                gaMeasurementId={sanitizeGaId(branding)}
                {...(extraHead ? { extraHead } : {})}
            />
            <body class="bg-[#f8fafc] dark:bg-slate-900 text-slate-900 dark:text-slate-100 antialiased min-h-screen" x-data="{ mobileMenu: false }">
                {branding?.tenantStatus === 'suspended' && (
                    <div id="suspensionBanner" class="bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-700 px-4 py-3 flex items-center justify-center gap-3 relative z-50">
                        <svg class="w-5 h-5 flex-shrink-0 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"></path></svg>
                        <p class="text-sm font-semibold text-amber-800 dark:text-amber-200">
                            This workspace is suspended. You can view existing content but cannot create or edit inspections. Contact your administrator.
                        </p>
                        <button type="button" id="dismissSuspensionBanner" class="ml-auto flex-shrink-0 p-1 rounded-lg text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-800/50 hover:text-amber-800 dark:hover:text-amber-200 transition-colors" aria-label="Dismiss">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                    </div>
                )}
                {branding?.tenantStatus === 'suspended' && (
                    <script dangerouslySetInnerHTML={{ __html: `
                        (function() {
                            var banner = document.getElementById('suspensionBanner');
                            var btn = document.getElementById('dismissSuspensionBanner');
                            if (sessionStorage.getItem('oi-suspension-dismissed')) {
                                if (banner) banner.style.display = 'none';
                            }
                            if (btn) {
                                btn.addEventListener('click', function() {
                                    sessionStorage.setItem('oi-suspension-dismissed', '1');
                                    if (banner) banner.style.display = 'none';
                                });
                            }
                        })();
                    ` }} />
                )}
                {/* Mobile Header Bar */}
                <div class="lg:hidden sticky top-0 z-40 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 py-3 flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 flex-shrink-0">
                            <img src={logoUrl || '/logo.svg'} alt={siteName} class="w-full h-full object-contain" />
                        </div>
                        <span class="text-lg font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">{siteName}</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <a href="/notifications" class="relative flex items-center justify-center w-10 h-10 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-indigo-600 transition-all" aria-label="Notifications">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>
                            <span id="notifyUnreadBadgeMobile" class="hidden absolute -top-0.5 -right-0.5 px-1.5 min-w-[1.25rem] h-5 text-center rounded-full bg-rose-500 text-white text-[10px] font-bold leading-5"></span>
                        </a>
                        <button x-on:click="mobileMenu = true" class="p-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-indigo-600 transition-colors" aria-label="Open menu">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
                        </button>
                    </div>
                </div>

                {/* Mobile Menu Overlay */}
                <div x-cloak x-show="mobileMenu" class="fixed inset-0 z-50 lg:hidden">
                    {/* Backdrop */}
                    <div x-show="mobileMenu" x-transition:enter="transition ease-out duration-200" x-transition:enter-start="opacity-0" x-transition:enter-end="opacity-100" x-transition:leave="transition ease-in duration-150" x-transition:leave-start="opacity-100" x-transition:leave-end="opacity-0" x-on:click="mobileMenu = false" class="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"></div>
                    {/* Panel */}
                    <div x-show="mobileMenu" x-transition:enter="transition ease-out duration-200" x-transition:enter-start="opacity-0 -translate-x-full" x-transition:enter-end="opacity-100 translate-x-0" x-transition:leave="transition ease-in duration-150" x-transition:leave-start="opacity-100 translate-x-0" x-transition:leave-end="opacity-0 -translate-x-full" class="relative w-80 max-w-[85vw] h-full bg-white dark:bg-slate-900 shadow-2xl flex flex-col">
                        {/* Close header */}
                        <div class="p-6 flex items-center justify-between border-b border-slate-100 dark:border-slate-700">
                            <div class="flex items-center gap-3">
                                <div class="w-9 h-9 flex-shrink-0">
                                    <img src={logoUrl || '/logo.svg'} alt={siteName} class="w-full h-full object-contain" />
                                </div>
                                <span class="text-xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">{siteName}</span>
                            </div>
                            <button x-on:click="mobileMenu = false" class="p-2 rounded-xl text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600 dark:hover:text-slate-300 transition-colors" aria-label="Close menu">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>
                        {/* Nav links */}
                        <nav class="flex-1 p-4 space-y-1 overflow-y-auto">
                            {/* Sprint 1 Sub-spec B Task 2 — mobile mirrors desktop IA. */}
                            <a href="/dashboard" class="flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>
                                <span>Inspections</span>
                                <span id="msgUnreadBadge" class="hidden ml-auto px-1.5 min-w-[1.25rem] text-center rounded-full bg-rose-500 text-white text-[10px] font-bold leading-5"></span>
                            </a>
                            <a href="/calendar" class="flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                <span>Calendar</span>
                            </a>
                            {/* Library group (mobile) — collapsible. */}
                            <details class="group [&>summary]:list-none" data-sidebar-library>
                                <summary class="cursor-pointer flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all font-semibold">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>
                                    <span class="flex-1">Library</span>
                                    <svg class="w-4 h-4 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                                </summary>
                                {/* Iter-2 bug #8 — canonical Library order: Inspection
                                    Templates / Marketplace / Comments / Repair Items /
                                    Tags / Agreements / Rating Systems. All seven entries
                                    are required; the previous order shipped Marketplace
                                    after Agreements which made customers think it was
                                    missing when the menu was reading-cut on small
                                    viewports. */}
                                <div class="mt-1 ml-7 pl-3 border-l border-slate-100 dark:border-slate-700 space-y-0.5">
                                    <a href="/templates" class="block px-3 py-2 rounded-md text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Inspection Templates</a>
                                    <a href="/marketplace" class="block px-3 py-2 rounded-md text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Marketplace</a>
                                    <a href="/comments" class="block px-3 py-2 rounded-md text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Comments</a>
                                    <a href="/recommendations" class="block px-3 py-2 rounded-md text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Repair Items</a>
                                    <a href="/library/tags" class="block px-3 py-2 rounded-md text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Tags</a>
                                    <a href="/agreements" class="block px-3 py-2 rounded-md text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Agreements</a>
                                    <a href="/library/rating-systems" class="block px-3 py-2 rounded-md text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Rating Systems</a>
                                </div>
                            </details>
                            <a href="/contacts" class="flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                <span>Contacts</span>
                            </a>
                            <a href="/invoices" class="flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>
                                <span>Invoices</span>
                            </a>
                            <a href="/metrics" class="flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                                <span>Metrics</span>
                            </a>

                            {/* handoff-decisions §5 — Settings group fully expanded as
                                a flat sub-list. Section header has no chevron. */}
                            <div class="pt-4 mt-4 border-t border-slate-100 dark:border-slate-700">
                                <a href="/settings" class="block px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 hover:text-indigo-600">Settings</a>
                                <div class="space-y-0">
                                    <a href="/settings/profile" class="flex items-center h-7 pl-[30px] pr-4 rounded-lg text-[13px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-medium">Profile</a>
                                    <a href="/settings/workspace/branding" class="flex items-center h-7 pl-[30px] pr-4 rounded-lg text-[13px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-medium">Branding</a>
                                    <a href="/settings/workspace/theme" class="flex items-center h-7 pl-[30px] pr-4 rounded-lg text-[13px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-medium">Report Theme</a>
                                    <a href="/settings/workspace/telemetry" class="flex items-center h-7 pl-[30px] pr-4 rounded-lg text-[13px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-medium">Telemetry</a>
                                    <a href="/settings/catalog/services" class="flex items-center h-7 pl-[30px] pr-4 rounded-lg text-[13px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-medium">Services &amp; Pricing</a>
                                    <a href="/settings/catalog/event-types" class="flex items-center h-7 pl-[30px] pr-4 rounded-lg text-[13px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-medium">Event Types</a>
                                    <a href="/settings/catalog/widget" class="flex items-center h-7 pl-[30px] pr-4 rounded-lg text-[13px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-medium">Embed Widget</a>
                                    <a href="/settings/communication/email" class="flex items-center h-7 pl-[30px] pr-4 rounded-lg text-[13px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-medium">Email</a>
                                    <a href="/settings/communication/automations" class="flex items-center h-7 pl-[30px] pr-4 rounded-lg text-[13px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-medium">Automations</a>
                                    <a href="/settings/communication/calendar" class="flex items-center h-7 pl-[30px] pr-4 rounded-lg text-[13px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-medium">Apple Calendar</a>
                                    <a href="/settings/communication/integrations" class="flex items-center h-7 pl-[30px] pr-4 rounded-lg text-[13px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-medium">Integrations</a>
                                    <a href="/settings/account/password" class="flex items-center h-7 pl-[30px] pr-4 rounded-lg text-[13px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-medium">Change Password</a>
                                    <a href="/settings/account/security" class="flex items-center h-7 pl-[30px] pr-4 rounded-lg text-[13px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-medium">Two-factor (2FA)</a>
                                    <a href="/settings/account/bot-protection" class="flex items-center h-7 pl-[30px] pr-4 rounded-lg text-[13px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-medium">Bot Protection</a>
                                    <a href="/settings/advanced/payments" class="flex items-center h-7 pl-[30px] pr-4 rounded-lg text-[13px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-medium">Payments</a>
                                    <a href="/settings/advanced/ai" class="flex items-center h-7 pl-[30px] pr-4 rounded-lg text-[13px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-medium">AI</a>
                                    <a href="/settings/advanced/data" class="flex items-center h-7 pl-[30px] pr-4 rounded-lg text-[13px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-medium">Data Import / Export</a>
                                </div>
                            </div>
                        </nav>
                        {/* Bottom section */}
                        <div class="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/20 space-y-1">
                            {/* Shared-SaaS only: deep-link to portal's workspace picker.
                                A multi-workspace identity has no in-core way to swap
                                tenants (the JWT carries a single tenantId), so the
                                only correct move is to bounce to portal where the
                                memberships list lives — portal's /workspace/switch
                                will SSO us back here with the picked tenant's cookie. */}
                            {branding?.isSharedSaas && branding?.portalBaseUrl && (
                                <a href={`${branding.portalBaseUrl}/workspace/switch`}
                                   class="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all font-semibold">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>
                                    <span class="flex-1 text-left text-sm">Switch workspace</span>
                                    <svg class="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
                                </a>
                            )}
                            <div x-data="themeMenu()" class="relative" {...{'x-on:click.outside': 'open = false'}}>
                                <button type="button" x-on:click="open = !open" class="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all font-semibold" aria-label="Color scheme">
                                    <svg id="mobileThemeMoonIcon" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
                                    <svg id="mobileThemeSunIcon" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
                                    <svg id="mobileThemeAutoIcon" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                                    <span id="mobileThemeLabel" class="flex-1 text-left text-sm">Auto</span>
                                    <svg class="w-3.5 h-3.5 flex-shrink-0 transition-transform" x-bind:class="open ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                                </button>
                                <div style="display:none" x-show="open" class="absolute bottom-full left-0 right-0 mb-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-50 py-1 overflow-hidden">
                                    <button type="button" x-on:click="set('auto')" class="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                                        <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                                        <span class="flex-1 text-left">Auto</span>
                                        <svg x-show="mode === 'auto'" class="w-4 h-4 text-indigo-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                                    </button>
                                    <button type="button" x-on:click="set('dark')" class="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                                        <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
                                        <span class="flex-1 text-left">Dark</span>
                                        <svg x-show="mode === 'dark'" class="w-4 h-4 text-indigo-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                                    </button>
                                    <button type="button" x-on:click="set('light')" class="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                                        <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
                                        <span class="flex-1 text-left">Light</span>
                                        <svg x-show="mode === 'light'" class="w-4 h-4 text-indigo-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                                    </button>
                                </div>
                            </div>
                            <button id="mobileLogoutBtn" class="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                                <span>Sign Out</span>
                            </button>
                        </div>
                    </div>
                </div>

                <div class="flex min-h-screen">
                    {/* Sidebar / Navigation */}
                    <aside class="w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 hidden lg:flex flex-col sticky top-0 h-screen">
                        <div class="p-8 flex items-center gap-4 border-b border-slate-100 dark:border-slate-700">
                            <div class="w-10 h-10 flex-shrink-0">
                                <img src={logoUrl || '/logo.svg'} alt={siteName} class="w-full h-full object-contain" />
                            </div>
                            <span class="text-xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight leading-tight">{siteName}</span>
                            <a href="/notifications" class="ml-auto relative flex items-center justify-center w-10 h-10 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-indigo-600 transition-all" aria-label="Notifications">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>
                                <span id="notifyUnreadBadge" class="hidden absolute -top-0.5 -right-0.5 px-1.5 min-w-[1.25rem] h-5 text-center rounded-full bg-rose-500 text-white text-[10px] font-bold leading-5"></span>
                            </a>
                        </div>

                        <nav class="flex-1 p-6 space-y-2 overflow-y-auto">
                            {/* Search pill — opens command palette. Visible click affordance
                                in addition to ⌘K (Mac) / Ctrl+K. Chrome on Windows captures
                                Ctrl+K for the omnibox so this button is the primary path. */}
                            <button
                                type="button"
                                id="oi-cmdk-trigger"
                                x-data="{ isMac: navigator.platform?.startsWith('Mac') }"
                                x-on:click="window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))"
                                class="w-full flex items-center gap-3 px-5 py-3 mb-2 rounded-2xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all border border-slate-200/60 dark:border-slate-700/60 group"
                                aria-label="Open command palette"
                            >
                                <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M16.5 10.5a6 6 0 11-12 0 6 6 0 0112 0z"></path></svg>
                                <span class="text-sm font-medium">Search…</span>
                                <kbd class="ml-auto px-1.5 py-0.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded text-[10px] font-mono text-slate-500 dark:text-slate-400 group-hover:border-slate-300" x-text="isMac ? '⌘K' : 'Ctrl /'">⌘K</kbd>
                            </button>
                            {/* Sprint 1 Sub-spec B Task 2 — IA: 5 顶级 + Library + Settings.
                                Order: Inspections / Calendar / Library / Contacts / Invoices / Metrics.
                                Library group uses semantic <details> (auto-expand handled inline below).
                                Reports merged into Inspections (Recent reports bucket on dashboard).
                                Team relocated under Settings. */}
                            <a href="/dashboard" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all font-semibold group relative">
                                <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>
                                <span>Inspections</span>
                            </a>
                            <a href="/calendar" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all font-semibold group">
                                <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                <span>Calendar</span>
                            </a>
                            {/* Library group — collapsible. Auto-expanded server-side
                                via the activate-sidebar script (sets `open` when current
                                path starts with any Library route). */}
                            <details class="group [&>summary]:list-none" data-sidebar-library>
                                <summary class="cursor-pointer flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all font-semibold">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>
                                    <span class="flex-1">Library</span>
                                    <svg class="w-4 h-4 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                                </summary>
                                {/* Iter-2 bug #8 — canonical Library order, kept in
                                    sync with the mobile drawer above. */}
                                <div class="mt-1 ml-7 pl-3 border-l border-slate-100 dark:border-slate-700 space-y-0.5">
                                    <a href="/templates" class="block px-3 py-2 rounded-md text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Inspection Templates</a>
                                    <a href="/marketplace" class="block px-3 py-2 rounded-md text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Marketplace</a>
                                    <a href="/comments" class="block px-3 py-2 rounded-md text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Comments</a>
                                    <a href="/recommendations" class="block px-3 py-2 rounded-md text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Repair Items</a>
                                    <a href="/library/tags" class="block px-3 py-2 rounded-md text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Tags</a>
                                    <a href="/agreements" class="block px-3 py-2 rounded-md text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Agreements</a>
                                    <a href="/library/rating-systems" class="block px-3 py-2 rounded-md text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Rating Systems</a>
                                </div>
                            </details>
                            <a href="/contacts" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all font-semibold group">
                                <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                <span>Contacts</span>
                            </a>
                            <a href="/invoices" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all font-semibold group">
                                <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>
                                <span>Invoices</span>
                            </a>
                            <a href="/metrics" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all font-semibold group">
                                <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                                <span>Metrics</span>
                            </a>
                        </nav>

                        <div class="p-6 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/20">
                             <a href="/settings" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 hover:text-indigo-600 dark:hover:text-indigo-400 hover:shadow-sm transition-all font-semibold group">
                                <svg class="w-5 h-5 group-hover:rotate-45 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 002.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                <span>Settings</span>
                            </a>
                            {/* Shared-SaaS only — mirrors the mobile drawer entry. */}
                            {branding?.isSharedSaas && branding?.portalBaseUrl && (
                                <a href={`${branding.portalBaseUrl}/workspace/switch`}
                                   class="flex items-center gap-3 px-5 py-4 mt-2 rounded-2xl text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 hover:text-indigo-600 dark:hover:text-indigo-400 hover:shadow-sm transition-all font-semibold group">
                                    <svg class="w-5 h-5 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>
                                    <span class="flex-1">Switch workspace</span>
                                    <svg class="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                                </a>
                            )}
                            <div x-data="themeMenu()" class="relative mt-2" {...{'x-on:click.outside': 'open = false'}}>
                                <button type="button" x-on:click="open = !open" class="w-full flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 hover:text-indigo-600 dark:hover:text-indigo-400 hover:shadow-sm transition-all font-semibold group" aria-label="Color scheme">
                                    <svg id="themeMoonIcon" class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
                                    <svg id="themeSunIcon" class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
                                    <svg id="themeAutoIcon" class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                                    <span id="themeToggleLabel" class="flex-1 text-left text-sm">Auto</span>
                                    <svg class="w-3.5 h-3.5 flex-shrink-0 transition-transform" x-bind:class="open ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                                </button>
                                <div style="display:none" x-show="open" class="absolute bottom-full left-0 right-0 mb-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-50 py-1 overflow-hidden">
                                    <button type="button" x-on:click="set('auto')" class="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                                        <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                                        <span class="flex-1 text-left">Auto</span>
                                        <svg x-show="mode === 'auto'" class="w-4 h-4 text-indigo-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                                    </button>
                                    <button type="button" x-on:click="set('dark')" class="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                                        <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
                                        <span class="flex-1 text-left">Dark</span>
                                        <svg x-show="mode === 'dark'" class="w-4 h-4 text-indigo-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                                    </button>
                                    <button type="button" x-on:click="set('light')" class="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                                        <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
                                        <span class="flex-1 text-left">Light</span>
                                        <svg x-show="mode === 'light'" class="w-4 h-4 text-indigo-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                                    </button>
                                </div>
                            </div>
                            <button id="logoutBtn" class="w-full flex items-center gap-3 px-5 py-4 rounded-2xl text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all font-semibold group mt-2">
                                <svg class="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                                <span>Sign Out</span>
                            </button>
                        </div>
                    </aside>

                    <main class="md:flex-1 w-full bg-[#f8fafc] dark:bg-slate-900 overflow-y-auto">
                        <div class="max-w-7xl mx-auto py-10 px-6 sm:px-8 lg:px-12">
                            {children}
                        </div>
                    </main>
                </div>
                <script dangerouslySetInnerHTML={{ __html: `
                    (function() {
                        var p = location.pathname;
                        var firstActive = null;
                        function applyHighlight() {
                            var isDark = document.documentElement.getAttribute('data-color-scheme') === 'dark';
                            document.querySelectorAll('aside a[href], nav a[href]').forEach(function(a) {
                                if (a.closest('nav[role="tablist"]')) return;
                                var isActive = a.getAttribute('href') === p || (a.getAttribute('href') === '/dashboard' && p === '/');
                                a.classList.remove('bg-indigo-50', 'text-indigo-600', 'bg-slate-700', 'text-white');
                                if (isActive) {
                                    if (isDark) {
                                        a.classList.add('bg-slate-700', 'text-white');
                                    } else {
                                        a.classList.add('bg-indigo-50', 'text-indigo-600');
                                    }
                                    a.classList.remove('text-slate-600');
                                    if (!firstActive) firstActive = a;
                                }
                            });
                        }
                        applyHighlight();
                        new MutationObserver(function() { applyHighlight(); }).observe(
                            document.documentElement,
                            { attributes: true, attributeFilter: ['data-color-scheme'] }
                        );
                        var libraryRoutes = ['/templates', '/comments', '/recommendations', '/agreements', '/marketplace', '/library/'];
                        var inLibrary = libraryRoutes.some(function(r) { return p.indexOf(r) === 0; });
                        if (inLibrary) {
                            document.querySelectorAll('details[data-sidebar-library]').forEach(function(d) { d.open = true; });
                        }
                        if (firstActive && typeof firstActive.scrollIntoView === 'function') {
                            try {
                                firstActive.scrollIntoView({ block: 'nearest', behavior: 'instant' });
                            } catch (e) {
                                firstActive.scrollIntoView({ block: 'nearest' });
                            }
                        }
                    })();
                ` }} />
                {/* B4 module loads moved into SharedHead so BareLayout pages
                    (form-renderer) get the offline pill / modal / banner too. */}
                <script src="/js/toast.js"></script>
                {/* Sign Out — wire both desktop + mobile buttons directly.
                    Two-stage logout in shared-SaaS mode: kill core's cookie
                    (POST /api/auth/logout on this origin) then redirect
                    through portal's GET /api/account/logout?returnTo=/login
                    so portal's __Host-inspector_workspace cookie also gets
                    cleared. Without that second hop, signing out on core
                    leaves the portal session alive and clicking /login again
                    silently SSOs the user back in — the opposite of what
                    a "sign out" button promises.

                    Standalone deploys (no PORTAL_API_URL) short-circuit to
                    /login on this origin — there is no portal cookie to
                    clear, so the extra hop would just be a confusing 404. */}
                <script dangerouslySetInnerHTML={{ __html: `
                    (function() {
                        var portalLogoutUrl = ${JSON.stringify(
                            branding?.portalBaseUrl
                                ? `${branding.portalBaseUrl}/api/account/logout?returnTo=/login`
                                : null,
                        )};
                        async function performLogout(e) {
                            if (e) e.preventDefault();
                            try {
                                await fetch('/api/auth/logout', {
                                    method: 'POST',
                                    credentials: 'same-origin',
                                });
                            } catch (_) { /* network failure still navigates */ }
                            window.location.href = portalLogoutUrl || '/login';
                        }
                        window.logout = performLogout;
                        document.getElementById('logoutBtn')?.addEventListener('click', performLogout);
                        document.getElementById('mobileLogoutBtn')?.addEventListener('click', performLogout);
                    })();
                ` }} />
                <div id="statusToast" class="fixed bottom-8 right-8 hidden items-center gap-3 px-3 py-2 rounded-2xl shadow-2xl text-sm font-bold text-white z-50 transition-all"></div>
                {/* Phase T (T25) — sidebar unread message badge polling */}
                <script dangerouslySetInnerHTML={{ __html: `
                    (function() {
                        async function pollUnread() {
                            try {
                                const r = await authFetch('/api/messages/unread-count');
                                if (!r.ok) return;
                                const d = await r.json();
                                const badge = document.getElementById('msgUnreadBadge');
                                if (!badge) return;
                                const count = d.data?.count || 0;
                                if (count > 0) {
                                    badge.textContent = count > 99 ? '99+' : String(count);
                                    badge.classList.remove('hidden');
                                } else {
                                    badge.classList.add('hidden');
                                }
                            } catch {}
                        }
                        if (typeof authFetch !== 'undefined') {
                            document.addEventListener('DOMContentLoaded', pollUnread);
                            setInterval(pollUnread, 60000);
                        }
                    })();
                ` }} />
                {/* B3 — notifications inbox unread badge polling.
                    Exposed as window.__oiPollNotify so pages that mutate the
                    unread state (e.g. notifications.js markAllRead) can force
                    an immediate refresh instead of waiting for the 60s tick. */}
                <script dangerouslySetInnerHTML={{ __html: `
                    (function() {
                        async function pollNotify() {
                            try {
                                const r = await authFetch('/api/notifications/unread-count');
                                if (!r.ok) return;
                                const d = await r.json();
                                const count = d.data?.count || 0;
                                const display = count > 99 ? '99+' : String(count);
                                ['notifyUnreadBadge', 'notifyUnreadBadgeMobile'].forEach(function(id) {
                                    const el = document.getElementById(id);
                                    if (!el) return;
                                    if (count > 0) { el.textContent = display; el.classList.remove('hidden'); }
                                    else { el.classList.add('hidden'); }
                                });
                            } catch {}
                        }
                        window.__oiPollNotify = pollNotify;
                        if (typeof authFetch !== 'undefined') {
                            document.addEventListener('DOMContentLoaded', pollNotify);
                            setInterval(pollNotify, 60000);
                        }
                    })();
                ` }} />
                {/* B4 — SW registration + message handlers. The PWA service
                    worker (offline-first cache + photo upload background sync)
                    lives at /sw.js but was never registered, so UC-I-6
                    (offline write-up) was broken. Registration is wrapped in
                    a feature guard and uses .catch(console.warn) so a failed
                    install can't crash the page. The same script is mirrored
                    in BareLayout below so public pages (/book,
                    /inspector/<slug>) also install the worker. */}
                <script dangerouslySetInnerHTML={{ __html: `
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js')
            .catch(function (err) { console.warn('[sw] registration failed', err); });
    });
}
navigator.serviceWorker?.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'drain-queue') {
        import('/js/sync-engine.js').then(function(m) { m.drainQueue(); }).catch(function() {});
    }
    if (e.data && e.data.type === 'sw-updated' && typeof window.showToast === 'function') {
        window.showToast('New version available — reload to apply.', false);
    }
});
` }} />
                <NetworkPill />
                <ConflictModal />
                <KeyboardHUD />
                <CommandPalette
                    currentUserSlug={paletteSlug}
                    {...(paletteHost ? { bookingHost: paletteHost } : {})}
                    {...(paletteTenant ? { tenantSubdomain: paletteTenant } : {})}
                />
                <InlineTextPopover />
            </body>
        </html>
    );
};
