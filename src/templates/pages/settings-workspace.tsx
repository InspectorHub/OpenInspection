import { SettingsLayout } from '../components/settings-layout';
import type { BrandingConfig } from '../../types/auth';

interface Props { branding?: BrandingConfig | undefined; }

// Sprint 2 S2-4 + Track E1 — extra props only used by the new Reports
// sub-page so the toggles reflect persisted state on first paint.
interface ReportsProps extends Props {
    showEstimates?:    boolean;
    enableRepairList?: boolean;
}

type WorkspaceSubPage = 'branding' | 'theme' | 'reports' | 'telemetry';

/* ─────────────────────────────  Branding  ───────────────────────────── */

export const SettingsWorkspaceBrandingPage = ({ branding }: Props): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    const primaryColor = branding?.primaryColor || '#6366f1';
    const logoUrl = branding?.logoUrl;

    return (
        <SettingsLayout
            branding={branding}
            title="Settings | Branding"
            group="workspace"
            subPage="branding"
            pageTitle="Branding"
            pageSubtitle="Workspace name, primary color, and logo. Shown to clients on reports and the booking page."
        >
            <section class="bg-white rounded-lg border border-surface-200 p-6 space-y-6">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div class="space-y-2">
                        <label for="siteName" class="block text-xs font-bold text-ink-700 uppercase tracking-[0.2em]">Workspace Name</label>
                        <input type="text" id="siteName" value={siteName}
                            class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none transition-all font-medium text-sm" />
                    </div>
                    <div class="space-y-2">
                        <label for="primaryColor" class="block text-xs font-bold text-ink-700 uppercase tracking-[0.2em]">Primary Color</label>
                        <div class="flex gap-3">
                            <input type="color" id="primaryColor" value={primaryColor}
                                class="h-10 w-16 rounded-md border border-surface-200 p-1 cursor-pointer bg-white" />
                            <input type="text" value={primaryColor} readonly
                                class="flex-1 px-3 py-2 rounded-md border border-surface-200 bg-surface-50 text-ink-600 font-mono text-sm cursor-default" />
                        </div>
                    </div>
                </div>

                <div class="space-y-3">
                    <label class="block text-xs font-bold text-ink-700 uppercase tracking-[0.2em]">Company Logo</label>
                    <div class="flex flex-col sm:flex-row items-center gap-5 p-5 bg-surface-50 rounded-md border border-dashed border-surface-200 group hover:border-blueprint-200 transition-colors">
                        <div class="w-28 h-28 bg-white rounded-md border border-surface-200 flex items-center justify-center overflow-hidden">
                            {logoUrl ? (
                                <img id="logoPreview" src={logoUrl} class="w-full h-full object-contain p-3" />
                            ) : (
                                <div id="logoPlaceholder" class="text-ink-300">
                                    <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                </div>
                            )}
                        </div>
                        <div class="space-y-2 flex-1 text-center sm:text-left">
                            <input type="file" id="logoInput" class="hidden" accept="image/*" onchange="handleLogoSelect(event)" />
                            <button onclick="document.getElementById('logoInput').click()"
                                class="px-4 py-2 rounded-md border border-surface-200 bg-white text-ink-700 text-sm font-semibold hover:bg-surface-100 transition-all">
                                Upload Asset
                            </button>
                            <p class="text-[11px] text-ink-500 font-bold uppercase tracking-widest">PNG / SVG recommended</p>
                        </div>
                    </div>
                </div>

                <div class="flex justify-end pt-2 border-t border-surface-200">
                    <button onclick="saveBranding()" id="saveBrandingBtn"
                        class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all disabled:bg-surface-200 disabled:cursor-not-allowed">
                        Save Branding
                    </button>
                </div>
            </section>

            <script src="/js/auth.js"></script>
            <script src="/js/settings.js"></script>
        </SettingsLayout>
    );
};

/* ─────────────────────────────  Theme  ───────────────────────────── */

export const SettingsWorkspaceThemePage = ({ branding }: Props): JSX.Element => {
    const reportTheme = branding?.reportTheme || 'modern';
    return (
        <SettingsLayout
            branding={branding}
            title="Settings | Report Theme"
            group="workspace"
            subPage="theme"
            pageTitle="Report Theme"
            pageSubtitle="Default visual style for client-facing reports. Per-inspection override is available on the inspection edit page."
        >
            <section
                class="bg-white rounded-lg border border-surface-200 p-6 space-y-5"
                x-data={`{
                    theme: '${reportTheme}',
                    saving: false,
                    async save() {
                        this.saving = true;
                        try {
                            const r = await authFetch('/api/admin/branding', {
                                method: 'POST',
                                headers: { 'content-type': 'application/json' },
                                body: JSON.stringify({ reportTheme: this.theme })
                            });
                            if (!r.ok) alert('Failed to save theme');
                        } catch (e) { alert('Failed to save theme'); }
                        finally { this.saving = false; }
                    }
                }`}
            >
                <div class="grid grid-cols-3 gap-3">
                    <template x-for="t in ['modern','classic','minimal']" {...{ 'x-bind:key': 't' }}>
                        <button
                            type="button"
                            x-on:click="theme = t; save()"
                            x-bind:class="theme === t ? 'border-blueprint-500 bg-blueprint-50 text-blueprint-700' : 'border-surface-200 bg-white text-ink-700 hover:border-surface-300'"
                            class="p-4 rounded-md border-2 text-sm font-bold uppercase tracking-[0.2em] capitalize transition-all"
                            x-text="t"
                        ></button>
                    </template>
                </div>
                <p class="text-xs text-ink-500" x-show="saving">Saving…</p>
            </section>

            <script src="/js/auth.js"></script>
        </SettingsLayout>
    );
};

/* ─────────────────────────────  Telemetry  ───────────────────────────── */

export const SettingsWorkspaceTelemetryPage = ({ branding }: Props): JSX.Element => {
    const gaMeasurementId = branding?.gaMeasurementId || '';
    return (
        <SettingsLayout
            branding={branding}
            title="Settings | Telemetry"
            group="workspace"
            subPage="telemetry"
            pageTitle="Telemetry"
            pageSubtitle="Optional Google Analytics 4 tracking on your client-facing pages (booking, reports). Leave blank to disable."
        >
            <section class="bg-white rounded-lg border border-surface-200 p-6 space-y-5">
                <div class="space-y-2 max-w-md">
                    <label for="gaMeasurementId" class="block text-xs font-bold text-ink-700 uppercase tracking-[0.2em]">GA Measurement ID</label>
                    <input type="text" id="gaMeasurementId" value={gaMeasurementId} placeholder="G-XXXXXXXXXX"
                        class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none transition-all font-medium text-sm placeholder:text-ink-300" />
                    <p class="text-[11px] text-ink-500">Format: <code class="font-mono">G-XXXXXXXXXX</code>.</p>
                </div>
                <div class="flex justify-end pt-2 border-t border-surface-200">
                    <button onclick="saveBranding()"
                        class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all">
                        Save
                    </button>
                </div>
            </section>

            <script src="/js/auth.js"></script>
            <script src="/js/settings.js"></script>
        </SettingsLayout>
    );
};

/* ─────────────────────────────  Reports (S2-4)  ───────────────────────────── */

/**
 * Sprint 2 S2-4 — toggle for "Show repair estimate ranges in published
 * reports". When on, the public report card stack renders the
 * `Estimated cost: $X – $Y` badge underneath the recommendation pill on
 * each defect item. Defaults to off so existing tenants don't suddenly
 * start showing dollar figures.
 */
export const SettingsWorkspaceReportsPage = ({ branding, showEstimates, enableRepairList }: ReportsProps): JSX.Element => {
    const initialEstimates    = showEstimates ? 'true' : 'false';
    const initialRepairList   = enableRepairList ? 'true' : 'false';
    return (
        <SettingsLayout
            branding={branding}
            title="Settings | Reports"
            group="workspace"
            subPage="reports"
            pageTitle="Reports"
            pageSubtitle="Control how published reports surface optional defect annotations such as repair estimate ranges and the contractor punch-list."
        >
            <section
                class="bg-white rounded-lg border border-surface-200 p-6 space-y-6"
                x-data={`{
                    showEstimates: ${initialEstimates},
                    enableRepairList: ${initialRepairList},
                    saving: false,
                    async save(payload) {
                        this.saving = true;
                        try {
                            const r = await authFetch('/api/admin/branding', {
                                method: 'POST',
                                headers: { 'content-type': 'application/json' },
                                body: JSON.stringify(payload)
                            });
                            if (!r.ok) {
                                if (typeof showToast === 'function') showToast('Failed to save', true);
                            } else {
                                if (typeof showToast === 'function') showToast('Saved');
                            }
                        } catch (e) {
                            if (typeof showToast === 'function') showToast('Failed to save', true);
                        }
                        finally { this.saving = false; }
                    }
                }`}
            >
                <label class="flex items-start justify-between gap-6 cursor-pointer">
                    <div class="flex-1">
                        <div class="text-sm font-bold text-ink-900">Show repair estimate ranges</div>
                        <div class="text-xs text-ink-500 mt-1 leading-relaxed">
                            When enabled, defect cards in the published report include the
                            inspector's estimated repair cost range (e.g.{' '}
                            <span class="font-mono text-ink-700">$500 – $1,500</span>).
                            Inspectors enter these numbers per defect on the inspection edit page.
                        </div>
                    </div>
                    <input
                        type="checkbox"
                        data-testid="settings-show-estimates-toggle"
                        x-model="showEstimates"
                        x-on:change="save({ showEstimates: showEstimates })"
                        class="mt-1 h-5 w-10 rounded-full appearance-none bg-surface-200 checked:bg-blueprint-500 transition-colors cursor-pointer relative shrink-0"
                        style="background-position: left center; background-repeat: no-repeat;"
                    />
                </label>

                {/* Track E1 (ITB §11) — Repair List toggle. */}
                <div class="border-t border-surface-200" />
                <label class="flex items-start justify-between gap-6 cursor-pointer">
                    <div class="flex-1">
                        <div class="text-sm font-bold text-ink-900">Enable Repair List</div>
                        <div class="text-xs text-ink-500 mt-1 leading-relaxed">
                            Opt-in punch-list view that aggregates every flagged defect across
                            the inspection into a clean, contractor-ready document. When on,
                            the published report exposes a "View Repair List" link in the
                            top-right and inspectors get a "Repair List" sub-tab in the
                            inspection editor.
                        </div>
                    </div>
                    <input
                        type="checkbox"
                        data-testid="settings-enable-repair-list-toggle"
                        x-model="enableRepairList"
                        x-on:change="save({ enableRepairList: enableRepairList })"
                        class="mt-1 h-5 w-10 rounded-full appearance-none bg-surface-200 checked:bg-blueprint-500 transition-colors cursor-pointer relative shrink-0"
                        style="background-position: left center; background-repeat: no-repeat;"
                    />
                </label>
                <p class="text-xs text-ink-400" x-show="saving">Saving…</p>
            </section>

            <script src="/js/auth.js"></script>
            <script src="/js/toast.js"></script>
        </SettingsLayout>
    );
};

/**
 * Dispatcher used by the route handler — picks the right component based on the
 * `subPage` URL segment. Keeps `index.ts` route registrations short.
 */
export const SettingsWorkspacePage = ({ branding, subPage, showEstimates, enableRepairList }: ReportsProps & { subPage: WorkspaceSubPage }): JSX.Element => {
    if (subPage === 'theme') return SettingsWorkspaceThemePage({ branding });
    if (subPage === 'telemetry') return SettingsWorkspaceTelemetryPage({ branding });
    if (subPage === 'reports') {
        const props: ReportsProps = { branding };
        if (typeof showEstimates    === 'boolean') props.showEstimates    = showEstimates;
        if (typeof enableRepairList === 'boolean') props.enableRepairList = enableRepairList;
        return SettingsWorkspaceReportsPage(props);
    }
    return SettingsWorkspaceBrandingPage({ branding });
};
