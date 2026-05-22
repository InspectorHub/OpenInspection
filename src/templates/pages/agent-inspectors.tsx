import type { BrandingConfig } from '../../types/auth';
import type { AgentInspectorRow } from '../../services/agent.service';
import { AgentCommandPalette } from '../components/agent-command-palette';
import { bookingUrl as buildBookingUrl } from '../../lib/public-urls';

export interface AgentInspectorsProps {
    branding?: BrandingConfig | undefined;
    agent: { name?: string | null; slug?: string | null };
    inspectors: AgentInspectorRow[];
    /**
     * Host the agent dashboard is served on (e.g. `app.inspectorhub.io` or
     * the standalone domain). The new path-tenant URL shape works
     * uniformly across all deploy modes from a single host.
     */
    host: string;
}

function initials(name: string | null | undefined): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return (parts[0]?.[0] ?? '?').toUpperCase();
    return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

function makeBookingUrl(host: string, tenantSubdomain: string, slug: string, ref: string | null): string {
    const base = buildBookingUrl(host, tenantSubdomain, slug);
    return ref ? `${base}?ref=${encodeURIComponent(ref)}` : base;
}

/**
 * Agent Accounts A2 — /agent-inspectors directory.
 *
 * Frontend-design directives (non-negotiable):
 *  - Inspector CARDS, not a row list (3-up at >=1024px, 2-up at 600-1023, 1-up below)
 *  - 64x64 circular photo OR initials placeholder
 *  - Inspector name (bold) + tenant name (smaller)
 *  - Copy button with hover-expanded URL preview
 *
 * Sprint 1 design tokens: surface / ink / blueprint, Fraunces serif headline,
 * DM Sans body. Card-first layout.
 */
export const AgentInspectorsPage = ({
    branding,
    agent,
    inspectors,
    host,
}: AgentInspectorsProps): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    const primaryColor = branding?.primaryColor || '#4f46e5';
    const refSlug = agent.slug ?? null;

    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>{`Your inspectors | ${siteName}`}</title>
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
                        max-width: 1080px; margin: 0 auto;
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
                        max-width: 1080px; margin: 0 auto;
                        padding: 1rem 1.5rem 4rem;
                    }
                    .editorial-h1 {
                        font-family: 'Fraunces', serif; font-weight: 700;
                        font-size: 2.25rem; line-height: 1.1; letter-spacing: -0.025em;
                        margin-bottom: 0.5rem;
                    }
                    .lede {
                        font-size: 1rem; line-height: 1.55;
                        color: var(--cp-fg-2); margin-bottom: 2rem;
                    }
                    .card-grid {
                        display: grid; gap: 1.25rem;
                        grid-template-columns: repeat(3, minmax(0, 1fr));
                    }
                    @media (max-width: 1023px) {
                        .card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                    }
                    @media (max-width: 599px) {
                        .card-grid { grid-template-columns: 1fr; }
                    }
                    .card {
                        background: var(--cp-bg-card);
                        border: 1px solid var(--cp-border-color);
                        border-radius: 16px;
                        padding: 1.5rem;
                        display: flex; flex-direction: column; gap: 1rem;
                        transition: transform 0.15s, box-shadow 0.15s;
                    }
                    .card:hover {
                        transform: translateY(-1px);
                        box-shadow: 0 8px 28px -16px rgba(0,0,0,0.18);
                    }
                    .card-header {
                        display: flex; align-items: center; gap: 1rem;
                    }
                    .avatar {
                        flex-shrink: 0;
                        width: 64px; height: 64px;
                        border-radius: 50%;
                        background: var(--cp-bg-muted);
                        display: flex; align-items: center; justify-content: center;
                        overflow: hidden;
                        font-family: 'Fraunces', serif; font-weight: 700;
                        font-size: 1.5rem;
                        color: var(--cp-fg-2);
                    }
                    .avatar img {
                        width: 100%; height: 100%; object-fit: cover;
                    }
                    .card-titles { min-width: 0; }
                    .card-name {
                        font-family: 'Fraunces', serif; font-weight: 700;
                        font-size: 1.125rem; letter-spacing: -0.01em;
                        line-height: 1.2; color: var(--cp-fg-1);
                        margin-bottom: 0.25rem;
                        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                    }
                    .card-tenant {
                        font-size: 0.75rem;
                        color: var(--cp-fg-2);
                        text-transform: uppercase; letter-spacing: 0.12em;
                        font-weight: 600;
                    }
                    .card-body {
                        font-size: 0.875rem;
                        color: var(--cp-fg-2);
                        line-height: 1.5;
                    }
                    .copy-row {
                        position: relative;
                        margin-top: auto;
                    }
                    .copy-btn {
                        width: 100%;
                        background: var(--primary);
                        color: #fff;
                        border: none;
                        border-radius: 10px;
                        padding: 0.625rem 1rem;
                        font-family: inherit;
                        font-size: 0.8125rem; font-weight: 700;
                        letter-spacing: 0.05em;
                        text-transform: uppercase;
                        cursor: pointer;
                        transition: background 0.15s;
                    }
                    .copy-btn:hover, .copy-btn:focus { background: ${primaryColor}d0; }
                    .copy-btn[data-copied="true"] {
                        background: #15803d;
                    }
                    .copy-preview {
                        position: absolute;
                        left: 0; right: 0; bottom: calc(100% + 0.5rem);
                        background: var(--cp-fg-1);
                        color: #fff;
                        padding: 0.5rem 0.75rem;
                        border-radius: 8px;
                        font-family: ui-monospace, 'SF Mono', monospace;
                        font-size: 0.6875rem;
                        word-break: break-all;
                        opacity: 0;
                        transform: translateY(4px);
                        pointer-events: none;
                        transition: opacity 0.15s, transform 0.15s;
                        z-index: 5;
                    }
                    .copy-row:hover .copy-preview,
                    .copy-row:focus-within .copy-preview {
                        opacity: 1;
                        transform: translateY(0);
                    }
                    .empty-card {
                        background: var(--cp-bg-card);
                        border: 1px dashed var(--cp-border-color);
                        border-radius: 16px;
                        padding: 3rem 2rem;
                        text-align: center;
                        color: var(--cp-fg-2);
                    }
                    .empty-card h3 {
                        font-family: 'Fraunces', serif; font-weight: 700;
                        font-size: 1.25rem; color: var(--cp-fg-1);
                        margin-bottom: 0.5rem;
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
                        <a class="topbar-link active" href="/agent-inspectors">Inspectors</a>
                        <a class="topbar-link" href="/agent-settings/profile">Settings</a>
                        <button id="signoutBtn" class="topbar-link" type="button">Sign out</button>
                    </nav>
                </header>

                <main class="shell">
                    <h1 class="editorial-h1">Your inspectors</h1>
                    <p class="lede">
                        Every team you partner with — copy a booking link to share with clients.
                    </p>

                    {inspectors.length === 0 ? (
                        <div class="empty-card" data-testid="agent-inspectors-empty">
                            <h3>No inspectors linked yet</h3>
                            <p>
                                Inspectors who invite you, or whose contact list already has your
                                email, will appear here automatically. There's nothing to do — just
                                check back after your next invite.
                            </p>
                        </div>
                    ) : (
                        <div class="card-grid">
                            {inspectors.map((row) => {
                                const slug = row.inspectorSlug;
                                const subdomain = row.tenantSubdomain;
                                const cardId = slug ?? 'no-slug';
                                if (!slug) {
                                    // Inspector hasn't published a slug yet — render a card without a copy button.
                                    return (
                                        <article class="card" data-testid={`inspector-card-${cardId}`}>
                                            <div class="card-header">
                                                {row.inspectorPhotoUrl ? (
                                                    <span class="avatar">
                                                        <img src={row.inspectorPhotoUrl} alt={row.inspectorName ?? row.tenantName} />
                                                    </span>
                                                ) : (
                                                    <span class="avatar" data-initials={initials(row.inspectorName ?? row.tenantName)}>
                                                        {initials(row.inspectorName ?? row.tenantName)}
                                                    </span>
                                                )}
                                                <div class="card-titles">
                                                    <div class="card-name">{row.inspectorName ?? row.tenantName}</div>
                                                    <div class="card-tenant">{row.tenantName}</div>
                                                </div>
                                            </div>
                                            <div class="card-body">
                                                This inspector hasn't published a booking slug yet.
                                                Once they do, you can copy their link from here.
                                            </div>
                                        </article>
                                    );
                                }

                                const url = makeBookingUrl(host, subdomain, slug, refSlug);
                                return (
                                    <article class="card" data-testid={`inspector-card-${slug}`}>
                                        <div class="card-header">
                                            {row.inspectorPhotoUrl ? (
                                                <span class="avatar">
                                                    <img src={row.inspectorPhotoUrl} alt={row.inspectorName ?? slug} />
                                                </span>
                                            ) : (
                                                <span class="avatar" data-initials={initials(row.inspectorName ?? slug)}>
                                                    {initials(row.inspectorName ?? slug)}
                                                </span>
                                            )}
                                            <div class="card-titles">
                                                <div class="card-name">{row.inspectorName ?? slug}</div>
                                                <div class="card-tenant">{row.tenantName}</div>
                                            </div>
                                        </div>
                                        <div class="copy-row">
                                            <span class="copy-preview" aria-hidden="true">{url}</span>
                                            <button
                                                type="button"
                                                class="copy-btn"
                                                data-testid={`copy-booking-${slug}`}
                                                data-booking-url={url}
                                                data-copied="false"
                                            >Copy booking link</button>
                                        </div>
                                        {/* Agent Accounts A3 — Book on Behalf entry point. Per
                                            directive the agent surfaces this on the inspector
                                            card so the action stays inside the inspector's
                                            partnership context. */}
                                        <a
                                            href={`/agent-inspectors/${slug}/concierge`}
                                            class="copy-btn"
                                            data-testid={`book-on-behalf-${slug}`}
                                            style="display:block; text-align:center; margin-top: 0.5rem; text-decoration:none;"
                                        >Book on behalf of client</a>
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </main>

                <script src="/js/agent-inspectors.js"></script>

                {/* UC-A-6 — agent ⌘K palette. Reuses the inspector list already
                    loaded for this page so no second fetch is needed. */}
                <script defer src="/vendor/alpine.min.js"></script>
                <AgentCommandPalette
                    inspectors={inspectors.map((row) => ({
                        name: row.inspectorName,
                        slug: row.inspectorSlug,
                        tenantSubdomain: row.tenantSubdomain,
                    }))}
                    agentSlug={refSlug}
                    bookingHost={host}
                />
            </body>
        </html>
    );
};
