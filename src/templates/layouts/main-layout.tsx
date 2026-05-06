import { BrandingConfig } from '../../types/auth';
import { NetworkPill } from '../components/network-pill';
import { ConflictModal } from '../components/conflict-modal';

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
            <link rel="stylesheet" href="/fonts.css" />
            <link rel="stylesheet" href="/vendor/flatpickr.min.css" />
            <script defer src="/vendor/alpine-collapse.min.js"></script>
            <script defer src="/vendor/alpine.min.js"></script>
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
            <script type="module" src="/js/template-drift-banner.js"></script>
            <link rel="stylesheet" href="/styles.css" />
            <style dangerouslySetInnerHTML={{ __html: `
                :root {
                    --primary-color: ${primaryColor};
                    --primary-glow: ${primaryColor}40;
                }
                body { font-family: 'Inter', sans-serif; }
                .glass { background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.3); }
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
                <NetworkPill />
                <ConflictModal />
            </body>
        </html>
    );
};

export const MainLayout = (props: { title: string, children: unknown, branding?: BrandingConfig | undefined, extraHead?: JSX.Element }): JSX.Element => {
    const { title, children, branding, extraHead } = props;
    const siteName = branding?.siteName || 'OpenInspection';
    const logoUrl = branding?.logoUrl;

    return (
        <html lang="en" class="scroll-smooth">
            <SharedHead
                title={title}
                primaryColor={sanitizePrimaryColor(branding)}
                gaMeasurementId={sanitizeGaId(branding)}
                {...(extraHead ? { extraHead } : {})}
            />
            <body class="bg-[#f8fafc] text-slate-900 antialiased min-h-screen" x-data="{ mobileMenu: false }">
                {/* Mobile Header Bar */}
                <div class="lg:hidden sticky top-0 z-40 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 flex-shrink-0">
                            <img src={logoUrl || '/logo.svg'} alt={siteName} class="w-full h-full object-contain" />
                        </div>
                        <span class="text-lg font-extrabold text-slate-900 tracking-tight">{siteName}</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <a href="/notifications" class="relative flex items-center justify-center w-10 h-10 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-indigo-600 transition-all" aria-label="Notifications">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>
                            <span id="notifyUnreadBadgeMobile" class="hidden absolute -top-0.5 -right-0.5 px-1.5 min-w-[1.25rem] h-5 text-center rounded-full bg-rose-500 text-white text-[10px] font-bold leading-5"></span>
                        </a>
                        <button x-on:click="mobileMenu = true" class="p-2 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-indigo-600 transition-colors" aria-label="Open menu">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
                        </button>
                    </div>
                </div>

                {/* Mobile Menu Overlay */}
                <div x-cloak x-show="mobileMenu" class="fixed inset-0 z-50 lg:hidden">
                    {/* Backdrop */}
                    <div x-show="mobileMenu" x-transition:enter="transition ease-out duration-200" x-transition:enter-start="opacity-0" x-transition:enter-end="opacity-100" x-transition:leave="transition ease-in duration-150" x-transition:leave-start="opacity-100" x-transition:leave-end="opacity-0" x-on:click="mobileMenu = false" class="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"></div>
                    {/* Panel */}
                    <div x-show="mobileMenu" x-transition:enter="transition ease-out duration-200" x-transition:enter-start="opacity-0 -translate-x-full" x-transition:enter-end="opacity-100 translate-x-0" x-transition:leave="transition ease-in duration-150" x-transition:leave-start="opacity-100 translate-x-0" x-transition:leave-end="opacity-0 -translate-x-full" class="relative w-80 max-w-[85vw] h-full bg-white shadow-2xl flex flex-col">
                        {/* Close header */}
                        <div class="p-6 flex items-center justify-between border-b border-slate-100">
                            <div class="flex items-center gap-3">
                                <div class="w-9 h-9 flex-shrink-0">
                                    <img src={logoUrl || '/logo.svg'} alt={siteName} class="w-full h-full object-contain" />
                                </div>
                                <span class="text-xl font-extrabold text-slate-900 tracking-tight">{siteName}</span>
                            </div>
                            <button x-on:click="mobileMenu = false" class="p-2 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors" aria-label="Close menu">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>
                        {/* Nav links */}
                        <nav class="flex-1 p-4 space-y-1 overflow-y-auto">
                            <a href="/dashboard" class="flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6z"></path></svg>
                                <span>Inspections</span>
                                <span id="msgUnreadBadge" class="hidden ml-auto px-1.5 min-w-[1.25rem] text-center rounded-full bg-rose-500 text-white text-[10px] font-bold leading-5"></span>
                            </a>
                            <a href="/templates" class="flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                                <span>Templates</span>
                            </a>
                            <a href="/marketplace" class="flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                                <span>Marketplace</span>
                            </a>
                            <a href="/agreements" class="flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                <span>Agreements</span>
                            </a>
                            <a href="/comments" class="flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-4 4v-4z"></path></svg>
                                <span>Comments</span>
                            </a>
                            <a href="/recommendations" class="flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>
                                <span>Recommendations</span>
                            </a>
                            <a href="/settings/services" class="flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
                                <span>Services</span>
                            </a>
                            <a href="/settings/event-types" class="flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9h6m-6 4h6"></path></svg>
                                <span>Event Types</span>
                            </a>
                            <a href="/settings/security" class="flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
                                <span>Security</span>
                            </a>
                            <a href="/contacts" class="flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                <span>Contacts</span>
                            </a>
                            <a href="/invoices" class="flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>
                                <span>Invoices</span>
                            </a>
                            <a href="/calendar" class="flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                <span>Calendar</span>
                            </a>
                            <a href="/team" class="flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                                <span>Team</span>
                            </a>
                            <a href="/metrics" class="flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                                <span>Metrics</span>
                            </a>
                        </nav>
                        {/* Bottom section */}
                        <div class="p-4 border-t border-slate-100 bg-slate-50/50 space-y-1">
                            <a href="/settings" class="flex items-center gap-3 px-4 py-3.5 rounded-xl text-slate-600 hover:bg-white hover:text-indigo-600 hover:shadow-sm transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 002.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                <span>Settings</span>
                            </a>
                            <button id="mobileLogoutBtn" class="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-red-600 hover:bg-red-50 transition-all font-semibold">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                                <span>Sign Out</span>
                            </button>
                        </div>
                    </div>
                </div>

                <div class="flex min-h-screen">
                    {/* Sidebar / Navigation */}
                    <aside class="w-72 bg-white border-r border-slate-200 hidden lg:flex flex-col sticky top-0 h-screen">
                        <div class="p-8 flex items-center gap-4 border-b border-slate-100">
                            <div class="w-10 h-10 flex-shrink-0">
                                <img src={logoUrl || '/logo.svg'} alt={siteName} class="w-full h-full object-contain" />
                            </div>
                            <span class="text-xl font-extrabold text-slate-900 tracking-tight leading-tight">{siteName}</span>
                            <a href="/notifications" class="ml-auto relative flex items-center justify-center w-10 h-10 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-indigo-600 transition-all" aria-label="Notifications">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path></svg>
                                <span id="notifyUnreadBadge" class="hidden absolute -top-0.5 -right-0.5 px-1.5 min-w-[1.25rem] h-5 text-center rounded-full bg-rose-500 text-white text-[10px] font-bold leading-5"></span>
                            </a>
                        </div>

                        <nav class="flex-1 p-6 space-y-2 overflow-y-auto">
                            <a href="/dashboard" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold group relative">
                                <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6z"></path></svg>
                                <span>Inspections</span>
                            </a>
                            <a href="/reports" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold group">
                                <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                                <span>Reports</span>
                            </a>
                            <a href="/templates" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold group">
                                <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                                <span>Templates</span>
                            </a>
                            <a href="/marketplace" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold group">
                                <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                                <span>Marketplace</span>
                            </a>
                            <a href="/agreements" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold group">
                                <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                <span>Agreements</span>
                            </a>
                            <a href="/comments" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold group">
                                <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-4 4v-4z"></path></svg>
                                <span>Comments</span>
                            </a>
                            <a href="/recommendations" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold group">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>
                                <span>Recommendations</span>
                            </a>
                            <a href="/settings/services" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold group">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
                                <span>Services</span>
                            </a>
                            <a href="/settings/event-types" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold group">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9h6m-6 4h6"></path></svg>
                                <span>Event Types</span>
                            </a>
                            <a href="/settings/security" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold group">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
                                <span>Security</span>
                            </a>
                            <a href="/contacts" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold group">
                                <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                <span>Contacts</span>
                            </a>
                            <a href="/calendar" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold group">
                                <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                <span>Calendar</span>
                            </a>
                            {/* Secondary nav (Invoices/Team/Metrics) folded so the primary 6 items fit
                                without scrolling on a typical 720-900px sidebar viewport. */}
                            <details class="[&>summary]:list-none">
                                <summary class="cursor-pointer flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-500 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold group">
                                    <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h.01M12 12h.01M19 12h.01"></path></svg>
                                    <span>More</span>
                                    <svg class="ml-auto w-4 h-4 details-chevron transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                                </summary>
                                <div class="mt-1 ml-2 pl-3 border-l border-slate-100 space-y-1">
                                    <a href="/invoices" class="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-500 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold text-sm">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>
                                        <span>Invoices</span>
                                    </a>
                                    <a href="/team" class="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-500 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold text-sm">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                                        <span>Team</span>
                                    </a>
                                    <a href="/metrics" class="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-500 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold text-sm">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                                        <span>Metrics</span>
                                    </a>
                                </div>
                            </details>
                        </nav>

                        <div class="p-6 border-t border-slate-100 bg-slate-50/50">
                             <a href="/settings" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 hover:bg-white hover:text-indigo-600 hover:shadow-sm transition-all font-semibold group">
                                <svg class="w-5 h-5 group-hover:rotate-45 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 002.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                <span>Settings</span>
                            </a>
                            <button id="logoutBtn" class="w-full flex items-center gap-3 px-5 py-4 rounded-2xl text-red-600 hover:bg-red-50 transition-all font-semibold group mt-2">
                                <svg class="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                                <span>Sign Out</span>
                            </button>
                        </div>
                    </aside>

                    <main class="md:flex-1 w-full bg-[#f8fafc] overflow-y-auto">
                        <div class="max-w-7xl mx-auto py-10 px-6 sm:px-8 lg:px-12">
                            {children}
                        </div>
                    </main>
                </div>
                <script dangerouslySetInnerHTML={{ __html: `
                    (function() {
                        var p = location.pathname;
                        document.querySelectorAll('aside a[href], nav a[href]').forEach(function(a) {
                            if (a.getAttribute('href') === p || (a.getAttribute('href') === '/dashboard' && p === '/')) {
                                a.classList.add('bg-indigo-50', 'text-indigo-600');
                                a.classList.remove('text-slate-600');
                            }
                        });
                    })();
                ` }} />
                {/* B4 module loads moved into SharedHead so BareLayout pages
                    (form-renderer) get the offline pill / modal / banner too. */}
                <script src="/js/toast.js"></script>
                <script dangerouslySetInnerHTML={{ __html: `
                    document.getElementById('mobileLogoutBtn')?.addEventListener('click', function() {
                        document.getElementById('logoutBtn')?.click();
                    });
                ` }} />
                <div id="statusToast" class="fixed bottom-8 right-8 hidden items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl text-sm font-bold text-white z-50 transition-all"></div>
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
                {/* B3 — notifications inbox unread badge polling */}
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
                        if (typeof authFetch !== 'undefined') {
                            document.addEventListener('DOMContentLoaded', pollNotify);
                            setInterval(pollNotify, 60000);
                        }
                    })();
                ` }} />
                {/* B4 — SW message handlers: drain queue on bg-sync, toast on SW update */}
                <script dangerouslySetInnerHTML={{ __html: `
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
            </body>
        </html>
    );
};
