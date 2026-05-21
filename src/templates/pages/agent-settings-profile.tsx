import type { BrandingConfig } from '../../types/auth';
import type { AgentInspectorRow } from '../../services/agent.service';
import { AgentCommandPalette } from '../components/agent-command-palette';

export interface AgentSettingsProfileProps {
    branding?: BrandingConfig | undefined;
    agent: {
        name?: string | null;
        email: string;
        slug?: string | null;
        notifyOnReferral: boolean;
        notifyOnReport: boolean;
        notifyOnPaid: boolean;
    };
    /** Linked inspectors — feeds the ⌘K palette's "Copy booking link" actions. */
    inspectors?: AgentInspectorRow[];
    /** Host suffix (e.g. `inspectorhub.io`) — used to compose booking URLs in the palette. */
    bookingHost?: string;
}

interface ToggleRowProps {
    testId: string;
    title: string;
    subtitle: string;
    field: 'notifyOnReferral' | 'notifyOnReport' | 'notifyOnPaid';
    active: boolean;
}

function ToggleRow({ testId, title, subtitle, field, active }: ToggleRowProps): JSX.Element {
    return (
        <div class="toggle-row" data-testid={testId} data-active={String(active)}>
            <div class="toggle-copy">
                <div class="toggle-title">{title}</div>
                <div class="toggle-sub">{subtitle}</div>
            </div>
            <button
                type="button"
                class={`toggle${active ? ' on' : ''}`}
                role="switch"
                aria-checked={active ? 'true' : 'false'}
                data-toggle-field={field}
            >
                <span class="toggle-thumb" aria-hidden="true"></span>
                <span class="toggle-state-label">{active ? 'On' : 'Off'}</span>
            </button>
        </div>
    );
}

/**
 * Agent Accounts A2 — /agent-settings/profile.
 *
 * Frontend-design directives (non-negotiable):
 *  - Mirror Sprint A's slug card UX (input + live booking-link preview).
 *  - Three notification toggles, color-coded (active=green, paused=slate).
 *  - Don't reinvent the slug pattern — we keep input shape + helper text style
 *    consistent with /settings/profile so an inspector who's also signed up
 *    as an agent can pattern-match between the two screens.
 */
export const AgentSettingsProfilePage = ({ branding, agent, inspectors = [], bookingHost = 'inspectorhub.io' }: AgentSettingsProfileProps): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    const primaryColor = branding?.primaryColor || '#4f46e5';
    const slug = agent.slug ?? null;
    const previewLink = slug ? `https://*.inspectorhub.io/book/<slug>?ref=${slug}` : null;

    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>{`Settings | ${siteName}`}</title>
                <script dangerouslySetInnerHTML={{ __html: `(function(){try{var L=localStorage.getItem('ih-color-scheme');if(L&&!localStorage.getItem('oi-color-scheme'))localStorage.setItem('oi-color-scheme',L);if(L)localStorage.removeItem('ih-color-scheme');}catch(e){}var s=localStorage.getItem('oi-color-scheme');var p=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-color-scheme',s==='dark'||(s===null&&p)?'dark':'light');})()`}} />
                <link rel="stylesheet" href="/fonts.css" />
                <style dangerouslySetInnerHTML={{ __html: `
                    :root {
                        --primary: ${primaryColor};
                        --primary-soft: ${primaryColor}14;
                    }
                    html[data-color-scheme="dark"] {
                        --primary-soft: ${primaryColor}26;
                    }
                    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
                    body {
                        font-family: 'DM Sans', system-ui, sans-serif;
                        background: var(--cp-bg);
                        color: var(--cp-fg-1);
                        min-height: 100vh;
                        -webkit-font-smoothing: antialiased;
                    }
                    .topbar {
                        max-width: 720px; margin: 0 auto;
                        padding: 1.75rem 1.5rem;
                        display: flex; align-items: center; justify-content: space-between;
                    }
                    .brand-row { display: flex; align-items: center; gap: 0.75rem; }
                    .brand-row img { width: 32px; height: 32px; object-fit: contain; }
                    .brand-name {
                        font-family: 'Fraunces', serif; font-weight: 700;
                        font-size: 1.125rem; letter-spacing: -0.02em;
                    }
                    .topbar-actions { display: flex; gap: 0.5rem; }
                    .topbar-link {
                        background: transparent; border: 1.5px solid var(--cp-border-color);
                        color: var(--cp-fg-1); padding: 0.5rem 1rem;
                        font-family: inherit; font-size: 0.8125rem; font-weight: 600;
                        border-radius: 10px; cursor: pointer; text-decoration: none;
                        transition: border-color 0.15s, background 0.15s;
                    }
                    .topbar-link:hover { border-color: var(--cp-fg-4); }
                    .topbar-link.active {
                        background: var(--primary-soft);
                        border-color: var(--primary);
                        color: var(--primary);
                    }
                    .shell {
                        max-width: 720px; margin: 0 auto;
                        padding: 1rem 1.5rem 4rem;
                    }
                    .editorial-h1 {
                        font-family: 'Fraunces', serif; font-weight: 700;
                        font-size: 2rem; line-height: 1.15; letter-spacing: -0.025em;
                        margin-bottom: 0.5rem;
                    }
                    .lede {
                        font-size: 0.9375rem; line-height: 1.55;
                        color: var(--cp-fg-2); margin-bottom: 2rem;
                    }
                    .card {
                        background: var(--cp-bg-card);
                        border: 1px solid var(--cp-border-color);
                        border-radius: 16px;
                        padding: 1.75rem;
                        margin-bottom: 1.25rem;
                    }
                    .card-eyebrow {
                        font-size: 0.6875rem; font-weight: 700;
                        text-transform: uppercase; letter-spacing: 0.18em;
                        color: var(--cp-fg-4);
                        margin-bottom: 0.5rem;
                    }
                    .card-title {
                        font-family: 'Fraunces', serif; font-weight: 700;
                        font-size: 1.125rem; letter-spacing: -0.01em;
                        margin-bottom: 0.25rem;
                    }
                    .card-help {
                        font-size: 0.8125rem; color: var(--cp-fg-2);
                        margin-bottom: 1.25rem;
                    }
                    label { display: block; font-size: 0.8125rem; color: var(--cp-fg-2); margin-bottom: 0.5rem; font-weight: 600; }
                    .input-row { display: flex; gap: 0.5rem; align-items: stretch; }
                    .input {
                        flex: 1;
                        padding: 0.625rem 0.875rem;
                        border: 1.5px solid var(--cp-border-color);
                        border-radius: 10px;
                        font-family: inherit; font-size: 0.9375rem;
                        background: var(--cp-bg-card);
                        color: var(--cp-fg-1);
                        outline: none;
                        transition: border-color 0.15s, box-shadow 0.15s;
                    }
                    .input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
                    .save-btn {
                        background: var(--primary); color: #fff; border: none;
                        padding: 0.625rem 1.25rem;
                        font-family: inherit; font-size: 0.8125rem; font-weight: 700;
                        text-transform: uppercase; letter-spacing: 0.05em;
                        border-radius: 10px; cursor: pointer;
                        transition: background 0.15s;
                    }
                    .save-btn:hover { filter: brightness(0.95); }
                    .save-btn:disabled { background: var(--cp-fg-4); cursor: not-allowed; }
                    .helper {
                        font-size: 0.75rem; color: var(--cp-fg-2);
                        margin-top: 0.5rem;
                    }
                    .helper.error { color: var(--ih-status-bad-fg); }
                    .helper.ok { color: var(--ih-status-ok-fg); }
                    .preview {
                        margin-top: 0.75rem;
                        background: var(--cp-bg-muted);
                        padding: 0.75rem 0.875rem;
                        border-radius: 10px;
                        font-family: ui-monospace, 'SF Mono', monospace;
                        font-size: 0.75rem; color: var(--cp-fg-2);
                        word-break: break-all;
                    }
                    .toggle-row {
                        display: flex; align-items: center;
                        gap: 1rem;
                        padding: 1rem 0;
                        border-top: 1px solid var(--cp-border-color);
                    }
                    .toggle-row:first-of-type { border-top: 0; }
                    .toggle-copy { flex: 1; min-width: 0; }
                    .toggle-title {
                        font-weight: 600; font-size: 0.9375rem;
                        margin-bottom: 0.125rem; color: var(--cp-fg-1);
                    }
                    .toggle-sub {
                        font-size: 0.75rem; color: var(--cp-fg-2);
                        line-height: 1.5;
                    }
                    .toggle {
                        flex-shrink: 0;
                        position: relative;
                        background: var(--cp-bg-muted);
                        color: var(--cp-fg-3);
                        border: 1.5px solid var(--cp-border-color);
                        border-radius: 999px;
                        padding: 0.25rem 0.75rem 0.25rem 2rem;
                        font-family: inherit; font-size: 0.75rem; font-weight: 700;
                        text-transform: uppercase; letter-spacing: 0.08em;
                        cursor: pointer;
                        min-width: 76px;
                        transition: background 0.15s, color 0.15s, border-color 0.15s;
                    }
                    .toggle.on {
                        background: var(--ih-status-ok-bg);
                        color: var(--ih-status-ok-fg);
                        border-color: var(--ih-status-ok-fg);
                    }
                    .toggle .toggle-thumb {
                        position: absolute;
                        left: 0.25rem; top: 50%;
                        width: 1.125rem; height: 1.125rem;
                        background: var(--cp-fg-3); color: #fff;
                        border-radius: 50%;
                        transform: translate(0, -50%);
                        transition: background 0.15s;
                    }
                    .toggle.on .toggle-thumb {
                        background: var(--ih-status-ok-fg);
                    }
                ` }} />
            </head>
            <body>
                <header class="topbar">
                    <div class="brand-row">
                        {branding?.logoUrl ? <img src={branding.logoUrl} alt={siteName} /> : null}
                        <span class="brand-name">{siteName}</span>
                    </div>
                    <nav class="topbar-actions">
                        <a class="topbar-link" href="/agent-dashboard">Dashboard</a>
                        <a class="topbar-link" href="/agent-inspectors">Inspectors</a>
                        <a class="topbar-link active" href="/agent-settings/profile">Settings</a>
                        <button id="signoutBtn" class="topbar-link" type="button">Sign out</button>
                    </nav>
                </header>

                <main class="shell">
                    <h1 class="editorial-h1">Settings</h1>
                    <p class="lede">
                        Your public referral slug and the emails we send you.
                    </p>

                    {/* Slug card — mirrors /settings/profile pattern */}
                    <section class="card">
                        <div class="card-eyebrow">Referral slug</div>
                        <h2 class="card-title">Your referral link</h2>
                        <p class="card-help">
                            When you share a booking link with a client, this slug attributes the
                            referral to you so the inspector knows where the client came from.
                        </p>

                        <label for="agentSlug">Slug</label>
                        <div class="input-row">
                            <input
                                type="text"
                                id="agentSlug"
                                name="slug"
                                class="input"
                                data-testid="agent-slug-input"
                                value={slug ?? ''}
                                data-current-slug={slug ?? ''}
                                placeholder="jane"
                                autocomplete="off"
                                spellcheck={false}
                            />
                            <button
                                type="button"
                                id="agentSlugSave"
                                data-testid="agent-slug-save"
                                class="save-btn"
                            >Save slug</button>
                        </div>
                        <p
                            id="agentSlugStatus"
                            data-testid="agent-slug-status"
                            class="helper"
                        >Lowercase letters, numbers, and hyphens (3-32 chars).</p>

                        {previewLink ? (
                            <div class="preview" data-testid="agent-slug-link">{previewLink}</div>
                        ) : (
                            <p class="helper" data-testid="agent-slug-empty-hint">
                                Pick a slug to start sharing your referral link.
                            </p>
                        )}
                    </section>

                    {/* Notification preferences card */}
                    <section class="card">
                        <div class="card-eyebrow">Notifications</div>
                        <h2 class="card-title">Email me when…</h2>
                        <p class="card-help">
                            High-signal alerts default ON. Toggle off any you don't want.
                        </p>
                        <ToggleRow
                            testId="agent-notify-referral"
                            title="A new referral is booked"
                            subtitle="When a client books an inspection using your referral link."
                            field="notifyOnReferral"
                            active={agent.notifyOnReferral}
                        />
                        <ToggleRow
                            testId="agent-notify-report"
                            title="A report is ready to read"
                            subtitle="When the inspector publishes the report for one of your referrals."
                            field="notifyOnReport"
                            active={agent.notifyOnReport}
                        />
                        <ToggleRow
                            testId="agent-notify-paid"
                            title="An invoice is paid"
                            subtitle="When your client pays the inspection invoice. (Off by default — high noise.)"
                            field="notifyOnPaid"
                            active={agent.notifyOnPaid}
                        />
                    </section>
                </main>

                <script src="/js/agent-settings-profile.js"></script>

                {/* UC-A-6 — agent ⌘K palette. Inspector list is fetched server-side
                    in the route handler so the palette has data on every page. */}
                <script defer src="/vendor/alpine.min.js"></script>
                <AgentCommandPalette
                    inspectors={inspectors.map((row) => ({
                        name: row.inspectorName,
                        slug: row.inspectorSlug,
                        tenantSubdomain: row.tenantSubdomain,
                    }))}
                    agentSlug={agent.slug ?? null}
                    bookingHost={bookingHost}
                />
            </body>
        </html>
    );
};
