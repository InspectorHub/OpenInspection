import { SettingsLayout } from '../components/settings-layout';
import { SEED_REFERRAL_SOURCES } from '../../lib/referral-sources';
import type { BrandingConfig } from '../../types/auth';

interface Props { branding?: BrandingConfig | undefined; }

// Sprint 2 S2-4 + Track E1 + Round-2 #10 — extra props only used by the
// new Reports sub-page so the toggles reflect persisted state on first paint.
interface ReportsProps extends Props {
    showEstimates?:               boolean;
    enableRepairList?:            boolean;
    enableCustomerRepairExport?:  boolean;
    blockUnpaid?:                 boolean;
    blockUnsignedAgreement?:      boolean;
    enablePdfPipeline?:           boolean;
}

// Round-2 backlog G3 — extra prop only used by the new Referral sub-page
// so the textarea hydrates with the workspace's saved custom labels.
interface ReferralProps extends Props {
    customReferralSources?: string[];
}

type WorkspaceSubPage = 'branding' | 'theme' | 'reports' | 'referral' | 'telemetry';

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
 *
 * Round-2 #10 — adds two more toggles for tenant-wide block-report policy
 * (block when invoice unpaid / block when agreement unsigned). Both groups
 * share the same Alpine `save()` shared method that PATCHes /api/branding.
 */
export const SettingsWorkspaceReportsPage = ({ branding, showEstimates, enableRepairList, enableCustomerRepairExport, blockUnpaid, blockUnsignedAgreement, enablePdfPipeline }: ReportsProps): JSX.Element => {
    const initialEstimates              = showEstimates ? 'true' : 'false';
    const initialRepairList             = enableRepairList ? 'true' : 'false';
    const initialCustomerRepairExport   = enableCustomerRepairExport ? 'true' : 'false';
    const initialBlockUnpaid            = blockUnpaid ? 'true' : 'false';
    const initialBlockUnsignedAgreement = blockUnsignedAgreement ? 'true' : 'false';
    const initialPdfPipeline            = enablePdfPipeline ? 'true' : 'false';
    return (
        <SettingsLayout
            branding={branding}
            title="Settings | Reports"
            group="workspace"
            subPage="reports"
            pageTitle="Reports"
            pageSubtitle="Control how published reports surface optional defect annotations and how new inspections gate the public report URL."
        >
            <section
                class="bg-white rounded-lg border border-surface-200 p-6 space-y-6"
                x-data={`{
                    showEstimates: ${initialEstimates},
                    enableRepairList: ${initialRepairList},
                    enableCustomerRepairExport: ${initialCustomerRepairExport},
                    blockUnpaid: ${initialBlockUnpaid},
                    blockUnsignedAgreement: ${initialBlockUnsignedAgreement},
                    enablePdfPipeline: ${initialPdfPipeline},
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
                <h3 class="text-[11px] font-bold text-ink-500 uppercase tracking-[0.2em]">
                    Defect annotations
                </h3>

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
                        class="mt-1 h-5 w-10 rounded-full appearance-none bg-surface-200 dark:bg-slate-600 checked:bg-blueprint-500 transition-colors cursor-pointer relative shrink-0"
                        style="background-position: left center; background-repeat: no-repeat;"
                        {...(showEstimates ? { checked: true } : {})}
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
                        class="mt-1 h-5 w-10 rounded-full appearance-none bg-surface-200 dark:bg-slate-600 checked:bg-blueprint-500 transition-colors cursor-pointer relative shrink-0"
                        style="background-position: left center; background-repeat: no-repeat;"
                        {...(enableRepairList ? { checked: true } : {})}
                    />
                </label>

                {/* Sprint 3 S3-2 — Customer-driven repair-request export. */}
                <div class="border-t border-surface-200" />
                <label class="flex items-start justify-between gap-6 cursor-pointer">
                    <div class="flex-1">
                        <div class="text-sm font-bold text-ink-900">Enable customer repair-request export</div>
                        <div class="text-xs text-ink-500 mt-1 leading-relaxed">
                            Surfaces a "Generate repair request" link on the published report
                            so the customer (homeowner / buyer) can produce a printable list
                            to hand off to a contractor. They can also email a copy to themselves.
                            The export honors the same payment + agreement gates as the report.
                        </div>
                    </div>
                    <input
                        type="checkbox"
                        data-testid="settings-enable-customer-repair-export-toggle"
                        x-model="enableCustomerRepairExport"
                        x-on:change="save({ enableCustomerRepairExport: enableCustomerRepairExport })"
                        class="mt-1 h-5 w-10 rounded-full appearance-none bg-surface-200 dark:bg-slate-600 checked:bg-blueprint-500 transition-colors cursor-pointer relative shrink-0"
                        style="background-position: left center; background-repeat: no-repeat;"
                        {...(enableCustomerRepairExport ? { checked: true } : {})}
                    />
                </label>

                {/* Migration 0059 — Workers Paid PDF pipeline opt-in. */}
                <div class="border-t border-surface-200" />
                <label class="flex items-start justify-between gap-6 cursor-pointer">
                    <div class="flex-1">
                        <div class="text-sm font-bold text-ink-900">Pre-render PDFs (Workers Paid only)</div>
                        <div class="text-xs text-ink-500 mt-1 leading-relaxed">
                            Renders Summary + Full PDFs to R2 in the background at publish
                            time and exposes a Refresh PDFs / Download PDF dropdown in the
                            report viewer. Requires Cloudflare Workers Paid plan (Browser
                            Rendering binding). Default OFF — the report viewer always
                            falls back to a free in-browser print dialog regardless of
                            this toggle.
                        </div>
                    </div>
                    <input
                        type="checkbox"
                        data-testid="settings-enable-pdf-pipeline-toggle"
                        x-model="enablePdfPipeline"
                        x-on:change="save({ enablePdfPipeline: enablePdfPipeline })"
                        class="mt-1 h-5 w-10 rounded-full appearance-none bg-surface-200 dark:bg-slate-600 checked:bg-blueprint-500 transition-colors cursor-pointer relative shrink-0"
                        style="background-position: left center; background-repeat: no-repeat;"
                        {...(enablePdfPipeline ? { checked: true } : {})}
                    />
                </label>

                {/* Round-2 #10 — Public report gating sub-section. The wrapper
                    div doubles as the visual divider between the two groups. */}
                <div class="pt-2 border-t border-surface-200">
                    <h3 class="text-[11px] font-bold text-ink-500 uppercase tracking-[0.2em]">
                        Public report gating
                    </h3>
                </div>

                <label class="flex items-start justify-between gap-6 cursor-pointer">
                    <div class="flex-1">
                        <div class="text-sm font-bold text-ink-900">Block report when invoice unpaid</div>
                        <div class="text-xs text-ink-500 mt-1 leading-relaxed">
                            New inspections withhold the public report URL until the invoice is paid.
                            Stripe webhook auto-unlocks on payment. Per-inspection override remains
                            available on the inspection edit page.
                        </div>
                    </div>
                    <input
                        type="checkbox"
                        data-testid="settings-block-unpaid-toggle"
                        x-model="blockUnpaid"
                        x-on:change="save({ blockUnpaid: blockUnpaid })"
                        class="mt-1 h-5 w-10 rounded-full appearance-none bg-surface-200 dark:bg-slate-600 checked:bg-blueprint-500 transition-colors cursor-pointer relative shrink-0"
                        style="background-position: left center; background-repeat: no-repeat;"
                        {...(blockUnpaid ? { checked: true } : {})}
                    />
                </label>

                <div class="border-t border-surface-200" />
                <label class="flex items-start justify-between gap-6 cursor-pointer">
                    <div class="flex-1">
                        <div class="text-sm font-bold text-ink-900">Block report when agreement unsigned</div>
                        <div class="text-xs text-ink-500 mt-1 leading-relaxed">
                            New inspections withhold the public report URL until the
                            pre-inspection agreement is signed. Once the client signs, the
                            report unlocks automatically.
                        </div>
                    </div>
                    <input
                        type="checkbox"
                        data-testid="settings-block-unsigned-agreement-toggle"
                        x-model="blockUnsignedAgreement"
                        x-on:change="save({ blockUnsignedAgreement: blockUnsignedAgreement })"
                        class="mt-1 h-5 w-10 rounded-full appearance-none bg-surface-200 dark:bg-slate-600 checked:bg-blueprint-500 transition-colors cursor-pointer relative shrink-0"
                        style="background-position: left center; background-repeat: no-repeat;"
                        {...(blockUnsignedAgreement ? { checked: true } : {})}
                    />
                </label>

                <p class="text-xs text-ink-400" x-show="saving">Saving…</p>
            </section>

            <script src="/js/auth.js"></script>
            <script src="/js/toast.js"></script>
        </SettingsLayout>
    );
};

/* ─────────────────────────────  Referral Sources (G3)  ───────────────────────────── */

/**
 * Round-2 backlog G3 (Spectora §4.1, ITB UC-ITB-10) — custom referral
 * sources. Tenants can append to the seven seeded values
 * (Realtor / Past Client / Google Search / Facebook / Yelp / Walk-in /
 * Other) by entering one label per line. We keep the form deliberately
 * MVP — no drag-reorder, no per-row delete — so a single textarea + Save
 * round-trips to `tenant_configs.custom_referral_sources` (JSON).
 */
export const SettingsWorkspaceReferralPage = ({ branding, customReferralSources }: ReferralProps): JSX.Element => {
    const initial = (customReferralSources ?? []).join('\n');
    return (
        <SettingsLayout
            branding={branding}
            title="Settings | Referral Sources"
            group="workspace"
            subPage="referral"
            pageTitle="Referral Sources"
            pageSubtitle="Extend the built-in referral source list shown on every inspection. One label per line."
        >
            <section
                class="bg-white rounded-lg border border-surface-200 p-6 space-y-5"
                x-data={`{
                    raw: ${JSON.stringify(initial)},
                    saving: false,
                    parse() {
                        return this.raw.split('\\n').map(s => s.trim()).filter(Boolean);
                    },
                    async save() {
                        this.saving = true;
                        try {
                            const r = await authFetch('/api/admin/branding', {
                                method: 'POST',
                                headers: { 'content-type': 'application/json' },
                                body: JSON.stringify({ customReferralSources: this.parse() })
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
                <div class="space-y-3">
                    <div class="text-xs font-bold uppercase tracking-[0.2em] text-ink-700">Built-in sources</div>
                    <ul class="flex flex-wrap gap-2">
                        {SEED_REFERRAL_SOURCES.map(s => (
                            <li class="px-2.5 py-1 rounded-md text-[11px] font-bold bg-surface-100 text-ink-700">{s}</li>
                        ))}
                    </ul>
                </div>

                <div class="space-y-2">
                    <label for="customReferralSources" class="block text-xs font-bold text-ink-700 uppercase tracking-[0.2em]">Custom labels</label>
                    <textarea
                        id="customReferralSources"
                        data-testid="settings-referral-textarea"
                        x-model="raw"
                        rows={8}
                        placeholder="Magazine ad
Trade show
Referral partner"
                        class="w-full px-3 py-2 rounded-md border border-surface-200 focus:border-blueprint-500 focus:ring-1 focus:ring-blueprint-500 outline-none transition-all font-medium text-sm placeholder:text-ink-300"
                    ></textarea>
                    <p class="text-[11px] text-ink-500">One label per line. Maximum 32 entries; duplicates are ignored.</p>
                </div>

                <div class="flex items-center justify-end gap-3 pt-2 border-t border-surface-200">
                    <span x-show="saving" class="text-xs text-ink-500">Saving…</span>
                    <button
                        x-on:click="save()"
                        x-bind:disabled="saving"
                        data-testid="settings-referral-save"
                        class="px-4 py-2 bg-blueprint-500 text-white rounded-md font-bold text-sm hover:bg-blueprint-700 active:scale-[.98] transition-all disabled:bg-surface-200"
                    >
                        Save
                    </button>
                </div>
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
export const SettingsWorkspacePage = (
    { branding, subPage, showEstimates, enableRepairList, enableCustomerRepairExport, blockUnpaid, blockUnsignedAgreement, enablePdfPipeline, customReferralSources }:
    ReportsProps & ReferralProps & { subPage: WorkspaceSubPage }
): JSX.Element => {
    if (subPage === 'theme') return SettingsWorkspaceThemePage({ branding });
    if (subPage === 'telemetry') return SettingsWorkspaceTelemetryPage({ branding });
    if (subPage === 'reports') {
        const props: ReportsProps = { branding };
        if (typeof showEstimates              === 'boolean') props.showEstimates              = showEstimates;
        if (typeof enableRepairList           === 'boolean') props.enableRepairList           = enableRepairList;
        if (typeof enableCustomerRepairExport === 'boolean') props.enableCustomerRepairExport = enableCustomerRepairExport;
        if (typeof blockUnpaid                === 'boolean') props.blockUnpaid                = blockUnpaid;
        if (typeof blockUnsignedAgreement     === 'boolean') props.blockUnsignedAgreement     = blockUnsignedAgreement;
        if (typeof enablePdfPipeline          === 'boolean') props.enablePdfPipeline          = enablePdfPipeline;
        return SettingsWorkspaceReportsPage(props);
    }
    if (subPage === 'referral') {
        const props: ReferralProps = { branding };
        if (Array.isArray(customReferralSources)) props.customReferralSources = customReferralSources;
        return SettingsWorkspaceReferralPage(props);
    }
    return SettingsWorkspaceBrandingPage({ branding });
};
