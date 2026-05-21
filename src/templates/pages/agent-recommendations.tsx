import type { BrandingConfig } from '../../types/auth';

interface Props { branding?: BrandingConfig | undefined }

/**
 * UC-A-5 — agent-side recommendations view. Hits /api/agents/my-recommendations
 * on init and renders three grouped panels (Safety / Recommendation /
 * Maintenance). Uses window.print() + @media print rules for PDF export so
 * we don't depend on the heavier Browser Rendering binding for what is
 * effectively a static list.
 */
export const AgentRecommendationsPage = ({ branding }: Props): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    const primary = branding?.primaryColor || '#F55A1A';
    const logoUrl = branding?.logoUrl;

    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>Recommendations · {siteName}</title>
                <script dangerouslySetInnerHTML={{ __html: `(function(){var s=localStorage.getItem('ih-color-scheme');var p=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-color-scheme',s==='dark'||(s===null&&p)?'dark':'light');})()`}} />
                <link rel="stylesheet" href="/css/main.css" />
                <link rel="stylesheet" href="/fonts.css" />
                <script src="/vendor/alpine.min.js" defer>{''}</script>
                <style dangerouslySetInnerHTML={{ __html: `
                    :root { --primary: ${primary}; --ink: #0f172a; --ink-soft: #475569; --ink-faint: #94a3b8; --line: #e2e8f0; --surface: #f8fafc; --surface-card: #fff; }
                    html[data-color-scheme="dark"] { --ink: #f1f5f9; --ink-soft: #cbd5e1; --ink-faint: #94a3b8; --line: rgba(255,255,255,0.10); --surface: #0b1120; --surface-card: #1e293b; }
                    body { font-family: 'DM Sans', system-ui, sans-serif; color: var(--ink); background: var(--surface); margin: 0; }
                    .topbar { display: flex; align-items: center; justify-content: space-between; padding: 1rem 2rem; border-bottom: 1px solid var(--line); background: var(--surface-card); }
                    .brand-row { display: flex; align-items: center; gap: 0.625rem; }
                    .brand-row img { height: 28px; width: auto; }
                    .brand-name { font-family: 'Fraunces', serif; font-weight: 700; font-size: 1.125rem; letter-spacing: -0.01em; }
                    .topbar-actions { display: flex; align-items: center; gap: 1rem; }
                    .topbar-link { color: var(--ink-soft); font-size: 0.875rem; font-weight: 600; text-decoration: none; }
                    .topbar-link:hover { color: var(--ink); }
                    .shell { max-width: 960px; margin: 0 auto; padding: 2rem; }
                    .editorial-h1 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 2.5rem; line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 0.5rem; }
                    .editorial-h1 em { color: var(--primary); font-style: normal; }
                    .lede { font-size: 1.0625rem; color: var(--ink-soft); margin: 0 0 1.5rem; }
                    .actions-row { display: flex; gap: 0.75rem; margin-bottom: 1.75rem; }
                    .btn { font-size: 0.875rem; font-weight: 600; padding: 0.5rem 1rem; border-radius: 8px; cursor: pointer; transition: all 0.12s; border: 1px solid var(--line); background: var(--surface-card); color: var(--ink); }
                    .btn:hover { border-color: var(--ink-faint); }
                    .btn-primary { background: var(--primary); color: #fff; border-color: var(--primary); }
                    .btn-primary:hover { filter: brightness(0.94); border-color: var(--primary); }
                    .group-card { background: var(--surface-card); border: 1px solid var(--line); border-radius: 16px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); }
                    .group-header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 1px solid var(--line); }
                    .group-title { font-family: 'Fraunces', serif; font-weight: 600; font-size: 1.5rem; letter-spacing: -0.01em; margin: 0; }
                    .group-title.safety { color: #b91c1c; }
                    .group-title.recommendation { color: var(--primary); }
                    .group-title.maintenance { color: #2563eb; }
                    .group-count { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-faint); }
                    .rec-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.875rem; }
                    .rec-row { padding: 1rem; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
                    .rec-meta { font-size: 0.75rem; color: var(--ink-faint); margin: 0 0 0.25rem; font-family: monospace; }
                    .rec-title { font-weight: 600; font-size: 0.9375rem; margin: 0 0 0.25rem; }
                    .rec-loc { font-size: 0.8125rem; color: var(--ink-soft); margin: 0 0 0.5rem; }
                    .rec-comment { font-size: 0.875rem; color: var(--ink); line-height: 1.5; margin: 0; }
                    .rec-empty { font-size: 0.875rem; color: var(--ink-faint); padding: 1rem 0; }
                    .loading-state, .error-state { padding: 3rem 2rem; text-align: center; color: var(--ink-soft); }
                    html[data-color-scheme="dark"] .group-title.safety { color: #f87171; }
                    html[data-color-scheme="dark"] .group-title.maintenance { color: #60a5fa; }
                    @media print {
                        .no-print { display: none !important; }
                        body { background: white; }
                        .group-card { box-shadow: none; page-break-inside: avoid; }
                        .topbar { display: none; }
                    }
                ` }} />
            </head>
            <body>
                <header class="topbar no-print">
                    <div class="brand-row">
                        {logoUrl ? <img src={logoUrl} alt={siteName} /> : null}
                        <span class="brand-name">{siteName}</span>
                    </div>
                    <nav class="topbar-actions">
                        <a class="topbar-link" href="/agent-dashboard">Dashboard</a>
                        <a class="topbar-link" href="/agent-inspectors">Inspectors</a>
                        <a class="topbar-link" href="/agent-settings/profile">Settings</a>
                        <button id="signoutBtn" class="topbar-link" type="button" style="background: none; border: none; cursor: pointer">Sign out</button>
                    </nav>
                </header>

                <main class="shell" x-data="agentRecommendations()" x-init="load()">
                    <h1 class="editorial-h1">
                        <em>Recommendations</em> across your referrals.
                    </h1>
                    <p class="lede">
                        Every defect flagged in a delivered inspection report,
                        grouped by Safety, Recommendation, and Maintenance.
                    </p>

                    <div class="actions-row no-print">
                        <button type="button" class="btn btn-primary" onclick="window.print()" data-testid="print-recommendations">Print as PDF</button>
                        <button type="button" class="btn" {...{ 'x-on:click': 'load()' }}>Refresh</button>
                    </div>

                    <div x-show="loading" class="loading-state" style="display: none">Loading…</div>
                    <div x-show="error" class="error-state" style="display: none" x-text="error" />

                    <template x-if="!loading && !error">
                        <div data-testid="recommendations-content">
                            <article class="group-card" data-testid="group-safety">
                                <header class="group-header">
                                    <h2 class="group-title safety">Safety</h2>
                                    <span class="group-count" x-text="`${groups.safety?.length || 0} item${(groups.safety?.length || 0) === 1 ? '' : 's'}`"></span>
                                </header>
                                <template x-if="groups.safety?.length">
                                    <ul class="rec-list">
                                        <template x-for="r in groups.safety" x-bind:key="r.inspectionId + ':' + r.itemLabel + ':' + r.defectTitle">
                                            <li class="rec-row">
                                                <p class="rec-meta" x-text="`${r.propertyAddress} · ${r.sectionTitle}`"></p>
                                                <p class="rec-title" x-text="r.defectTitle"></p>
                                                <p class="rec-loc" x-show="r.location" x-text="r.location"></p>
                                                <p class="rec-comment" x-text="r.comment"></p>
                                            </li>
                                        </template>
                                    </ul>
                                </template>
                                <template x-if="!groups.safety?.length"><p class="rec-empty">No safety items in your referred reports.</p></template>
                            </article>

                            <article class="group-card" data-testid="group-recommendation">
                                <header class="group-header">
                                    <h2 class="group-title recommendation">Recommendation</h2>
                                    <span class="group-count" x-text="`${groups.recommendation?.length || 0} item${(groups.recommendation?.length || 0) === 1 ? '' : 's'}`"></span>
                                </header>
                                <template x-if="groups.recommendation?.length">
                                    <ul class="rec-list">
                                        <template x-for="r in groups.recommendation" x-bind:key="r.inspectionId + ':' + r.itemLabel + ':' + r.defectTitle">
                                            <li class="rec-row">
                                                <p class="rec-meta" x-text="`${r.propertyAddress} · ${r.sectionTitle}`"></p>
                                                <p class="rec-title" x-text="r.defectTitle"></p>
                                                <p class="rec-loc" x-show="r.location" x-text="r.location"></p>
                                                <p class="rec-comment" x-text="r.comment"></p>
                                            </li>
                                        </template>
                                    </ul>
                                </template>
                                <template x-if="!groups.recommendation?.length"><p class="rec-empty">No recommendations in your referred reports.</p></template>
                            </article>

                            <article class="group-card" data-testid="group-maintenance">
                                <header class="group-header">
                                    <h2 class="group-title maintenance">Maintenance</h2>
                                    <span class="group-count" x-text="`${groups.maintenance?.length || 0} item${(groups.maintenance?.length || 0) === 1 ? '' : 's'}`"></span>
                                </header>
                                <template x-if="groups.maintenance?.length">
                                    <ul class="rec-list">
                                        <template x-for="r in groups.maintenance" x-bind:key="r.inspectionId + ':' + r.itemLabel + ':' + r.defectTitle">
                                            <li class="rec-row">
                                                <p class="rec-meta" x-text="`${r.propertyAddress} · ${r.sectionTitle}`"></p>
                                                <p class="rec-title" x-text="r.defectTitle"></p>
                                                <p class="rec-loc" x-show="r.location" x-text="r.location"></p>
                                                <p class="rec-comment" x-text="r.comment"></p>
                                            </li>
                                        </template>
                                    </ul>
                                </template>
                                <template x-if="!groups.maintenance?.length"><p class="rec-empty">No maintenance items in your referred reports.</p></template>
                            </article>
                        </div>
                    </template>
                </main>

                <script src="/js/auth.js">{''}</script>
                <script dangerouslySetInnerHTML={{ __html: `
                    function agentRecommendations() {
                        return {
                            loading: true,
                            error: '',
                            groups: { safety: [], recommendation: [], maintenance: [] },
                            async load() {
                                this.loading = true;
                                this.error = '';
                                try {
                                    const res = await authFetch('/api/agent/my-recommendations');
                                    const j = await res.json();
                                    if (!j.success) throw new Error(j.error?.message || 'Failed to load');
                                    this.groups = j.data;
                                } catch (e) {
                                    this.error = e.message || 'Network error';
                                } finally {
                                    this.loading = false;
                                }
                            },
                        };
                    }
                    document.getElementById('signoutBtn').addEventListener('click', () => logout());
                ` }} />
            </body>
        </html>
    );
};
