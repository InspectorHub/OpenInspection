import { MainLayout } from '../layouts/main-layout';
import { BrandingConfig } from '../../types/auth';
import { BUILD } from '../../generated/version';
import { SETTINGS_GROUPS } from '../components/settings-layout';
import { PageHeader } from '../components/page-header';

/**
 * Hub page at `/settings` — shows the 6 group cards (Profile / Workspace / Catalog /
 * Communication / Account / Advanced). Each card links into its group page where the
 * sub-nav takes over.
 *
 * Paper palette: bg-surface-50 page bg, white cards w/ surface-200 border,
 * blueprint-* accent, ink-* text scale.
 */
export const SettingsPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';

    return (
        <MainLayout title={`${siteName} | Settings`} branding={branding}>
            <div class="bg-surface-50 min-h-[calc(100vh-4rem)] -mx-4 -my-6 px-4 py-6 sm:px-6 sm:py-8">
                <div class="max-w-5xl mx-auto space-y-8 animate-fade-in">

                    {/* Resume-setup banner — shown by JS when onboarding was skipped */}
                    <div id="resumeSetupBanner" class="hidden px-5 py-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between">
                        <span class="text-sm text-amber-800 font-semibold">Setup is incomplete. Finish configuring your workspace to unlock all features.</span>
                        <a href="/setup" class="text-sm text-amber-900 font-bold hover:underline ml-4 whitespace-nowrap">Resume setup &rarr;</a>
                    </div>

                    {/* Header */}
                    <PageHeader
                        eyebrow="SETTINGS"
                        eyebrowColor="slate"
                        title="Settings"
                    />

                    {/* Group cards */}
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {SETTINGS_GROUPS.map((group) => {
                            // For single-sub-page groups (Profile), link straight to the page;
                            // otherwise link to the group's first sub-page.
                            const href = group.subPages.length === 1
                                ? group.subPages[0]!.href
                                : `/settings/${group.slug}`;
                            return (
                                <a
                                    href={href}
                                    class="group bg-white dark:bg-slate-800 rounded-lg border border-surface-200 dark:border-slate-700 p-5 hover:border-blueprint-200 dark:hover:border-slate-600 hover:shadow-md transition-all flex items-start gap-4"
                                >
                                    <div class="w-11 h-11 rounded-md bg-blueprint-100 text-blueprint-700 flex items-center justify-center flex-shrink-0 group-hover:bg-blueprint-500 group-hover:text-white transition-colors">
                                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={group.icon} />
                                        </svg>
                                    </div>
                                    <div class="flex-1 min-w-0">
                                        <div class="font-bold text-ink-900 dark:text-slate-100 text-sm tracking-tight">{group.label}</div>
                                        <div class="text-xs text-ink-600 dark:text-slate-400 mt-0.5">{group.description}</div>
                                        <div class="text-[11px] text-ink-500 dark:text-slate-500 mt-2 font-medium">
                                            {group.subPages.length} {group.subPages.length === 1 ? 'item' : 'items'} &middot; {group.subPages.map(s => s.label).join(', ')}
                                        </div>
                                    </div>
                                </a>
                            );
                        })}
                    </div>

                    {/* Build Info */}
                    <div class="flex items-center justify-between px-2 pt-4 pb-2 border-t border-surface-200">
                        <span class="text-[11px] text-ink-500 font-mono">
                            commit <a href={`https://github.com/InspectorHub/OpenInspection/commit/${BUILD.commit}`}
                                target="_blank" rel="noopener noreferrer"
                                class="text-ink-700 font-bold hover:text-blueprint-700 transition-colors">{BUILD.shortCommit}</a>
                        </span>
                        <span class="text-[11px] text-ink-500">
                            Built {new Date(BUILD.buildTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                    </div>

                    <script src="/js/auth.js"></script>
                    <script dangerouslySetInnerHTML={{ __html: `
(function () {
    fetch('/api/auth/me', { credentials: 'include' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
            var state = data && data.data && data.data.user && data.data.user.onboardingState;
            if (state && state.skipped && !state.completed) {
                var banner = document.getElementById('resumeSetupBanner');
                if (banner) banner.classList.remove('hidden');
            }
        })
        .catch(function () { /* best-effort */ });
})();
` }} />
                </div>
            </div>
        </MainLayout>
    );
};
