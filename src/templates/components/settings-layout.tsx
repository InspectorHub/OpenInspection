import { MainLayout } from '../layouts/main-layout';
import { SettingsCrumb, type CrumbItem } from './settings-crumb';
import type { BrandingConfig } from '../../types/auth';

/**
 * Group taxonomy. Must stay in sync with the routes registered in `src/index.ts`
 * and the IA design doc at `docs/superpowers/specs/2026-05-07-settings-ia-redesign.md`.
 */
export type SettingsGroup =
    | 'profile'
    | 'workspace'
    | 'catalog'
    | 'communication'
    | 'account'
    | 'advanced';

interface SubNavItem {
    slug: string;
    label: string;
    href: string;
    description: string;
}

interface GroupConfig {
    slug: SettingsGroup;
    label: string;
    description: string;
    icon: string; // SVG path d attribute
    subPages: SubNavItem[];
}

/**
 * Single source of truth for the settings group tree. Used by the hub page,
 * the SettingsLayout sub-nav, and the breadcrumb resolver.
 */
export const SETTINGS_GROUPS: readonly GroupConfig[] = [
    {
        slug: 'profile',
        label: 'Profile',
        description: 'Inspector identity. Shown on reports.',
        icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
        subPages: [
            { slug: 'profile', label: 'Profile', href: '/settings/profile', description: 'Name, phone, license #' },
        ],
    },
    {
        slug: 'workspace',
        label: 'Workspace',
        description: 'Branding, report theme, analytics.',
        icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z',
        subPages: [
            { slug: 'branding', label: 'Branding', href: '/settings/workspace/branding', description: 'Site name, color, logo' },
            { slug: 'theme', label: 'Report Theme', href: '/settings/workspace/theme', description: 'Modern / classic / minimal' },
            { slug: 'telemetry', label: 'Telemetry', href: '/settings/workspace/telemetry', description: 'Google Analytics' },
        ],
    },
    {
        slug: 'catalog',
        label: 'Services & Catalog',
        description: 'Inspection types, fees, add-ons, embed widget.',
        icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z',
        subPages: [
            { slug: 'services', label: 'Services & Pricing', href: '/settings/catalog/services', description: 'Standard fees, discounts' },
            { slug: 'event-types', label: 'Event Types', href: '/settings/catalog/event-types', description: 'Radon, sewer scope, follow-ups' },
            { slug: 'widget', label: 'Embed Widget', href: '/settings/catalog/widget', description: 'Booking snippet for your site' },
        ],
    },
    {
        slug: 'communication',
        label: 'Communication',
        description: 'Email delivery, automations, calendar sync.',
        icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
        subPages: [
            { slug: 'email', label: 'Email', href: '/settings/communication/email', description: 'Resend sender + API key' },
            { slug: 'automations', label: 'Automations', href: '/settings/communication/automations', description: 'Triggered emails' },
            { slug: 'calendar', label: 'Apple Calendar', href: '/settings/communication/calendar', description: 'ICS subscription' },
            { slug: 'integrations', label: 'Integrations', href: '/settings/communication/integrations', description: 'App URL, Google OAuth' },
        ],
    },
    {
        slug: 'account',
        label: 'Account',
        description: 'Password, two-factor, bot protection.',
        icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
        subPages: [
            { slug: 'password', label: 'Change Password', href: '/settings/account/password', description: 'Update your password' },
            { slug: 'security', label: 'Two-factor (2FA)', href: '/settings/account/security', description: 'TOTP authenticator' },
            { slug: 'bot-protection', label: 'Bot Protection', href: '/settings/account/bot-protection', description: 'Cloudflare Turnstile' },
        ],
    },
    {
        slug: 'advanced',
        label: 'Advanced',
        description: 'Payments, AI, data import/export.',
        icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
        subPages: [
            { slug: 'payments', label: 'Payments', href: '/settings/advanced/payments', description: 'Stripe Connect' },
            { slug: 'ai', label: 'AI', href: '/settings/advanced/ai', description: 'Gemini API key' },
            { slug: 'data', label: 'Data Import / Export', href: '/settings/advanced/data', description: 'CSV import, export' },
        ],
    },
] as const;

export function getGroupConfig(slug: SettingsGroup): GroupConfig {
    const found = SETTINGS_GROUPS.find((g) => g.slug === slug);
    if (!found) throw new Error(`Unknown settings group: ${slug}`);
    return found;
}

export interface SettingsLayoutProps {
    branding?: BrandingConfig | undefined;
    title: string;
    group: SettingsGroup;
    subPage: string;
    pageTitle: string;
    pageSubtitle?: string;
    children: unknown;
}

/**
 * Wraps a settings sub-page with breadcrumb (top) + sub-nav (left) + content slot.
 * Uses paper palette throughout (surface-*, ink-*, blueprint-*).
 */
export const SettingsLayout = ({
    branding,
    title,
    group,
    subPage,
    pageTitle,
    pageSubtitle,
    children,
}: SettingsLayoutProps): JSX.Element => {
    const groupConfig = getGroupConfig(group);
    const currentSub = groupConfig.subPages.find((s) => s.slug === subPage);
    const crumbs: CrumbItem[] = [
        { label: 'Settings', href: '/settings' },
        { label: groupConfig.label, href: `/settings/${group}` },
        ...(currentSub && groupConfig.subPages.length > 1 ? [{ label: currentSub.label }] : []),
    ];

    return (
        <MainLayout title={title} branding={branding}>
            <div class="bg-surface-50 min-h-[calc(100vh-4rem)] -mx-4 -my-6 px-4 py-6 sm:px-6 sm:py-8">
                <div class="max-w-6xl mx-auto space-y-6 animate-fade-in">
                    <SettingsCrumb items={crumbs} />

                    <div class="grid grid-cols-1 lg:grid-cols-[14rem_1fr] gap-6 lg:gap-8">
                        {/* Sub-nav: only render when group has 2+ sub-pages */}
                        {groupConfig.subPages.length > 1 && (
                            <aside class="lg:sticky lg:top-6 self-start">
                                <div class="bg-white rounded-lg border border-surface-200 overflow-hidden">
                                    <div class="px-4 py-3 border-b border-surface-200">
                                        <p class="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-500">{groupConfig.label}</p>
                                    </div>
                                    <ul class="py-1">
                                        {groupConfig.subPages.map((sub) => {
                                            const active = sub.slug === subPage;
                                            return (
                                                <li>
                                                    <a
                                                        href={sub.href}
                                                        class={
                                                            active
                                                                ? 'flex flex-col gap-0.5 px-4 py-2.5 border-l-[3px] border-blueprint-500 bg-surface-100 text-ink-900 font-bold text-sm'
                                                                : 'flex flex-col gap-0.5 px-4 py-2.5 border-l-[3px] border-transparent text-ink-700 hover:bg-surface-100 hover:text-ink-900 font-semibold text-sm transition-colors'
                                                        }
                                                    >
                                                        <span>{sub.label}</span>
                                                        <span class={active ? 'text-[11px] font-normal text-ink-600' : 'text-[11px] font-normal text-ink-500'}>{sub.description}</span>
                                                    </a>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            </aside>
                        )}

                        {/* Main column */}
                        <main class="min-w-0 space-y-6">
                            <header class="space-y-2">
                                <h1 class="text-2xl font-bold tracking-tight text-ink-900">{pageTitle}</h1>
                                {pageSubtitle && (
                                    <p class="text-sm text-ink-600 max-w-2xl">{pageSubtitle}</p>
                                )}
                            </header>
                            {children}
                        </main>
                    </div>
                </div>
            </div>
        </MainLayout>
    );
};
