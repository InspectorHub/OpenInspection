import type { BrandingConfig } from '../../types/auth';
import type { AgentReferralRow, AgentInspectorRow } from '../../services/agent.service';
import { AgentCommandPalette } from '../components/agent-command-palette';

export interface AgentDashboardProps {
    branding?: BrandingConfig | undefined;
    agent: { name?: string | null; email?: string | null; slug?: string | null };
    referrals: AgentReferralRow[];
    unreadReports: number;
    /**
     * Frontend-design polish #1 — 7-day rolling count of new referrals
     * for the 'Active referrals' stat card. Index 0 = oldest, last
     * index = today. Empty array hides the sparkline.
     */
    sparklineCreated?: number[];
    /** Linked inspectors — feeds the ⌘K palette's "Copy booking link" actions. */
    inspectors?: AgentInspectorRow[];
    /** Host suffix (e.g. `inspectorhub.io`) — used to compose booking URLs in the palette. */
    bookingHost?: string;
}

/**
 * Inline SVG sparkline for the stat-card lifecycle line.
 * Renders nothing when the data is empty or all-zero (avoids a flat
 * baseline that reads as broken). 88×24 with 2px stroke is the
 * visual equivalent of a single line of body text — small enough to
 * sit inside the card chrome, big enough to read at a glance.
 */
function Sparkline({ data, color }: { data: number[]; color: string }): JSX.Element | null {
    if (!data || data.length < 2) return null;
    const max = Math.max(...data, 1);
    if (data.every((v) => v === 0)) return null;
    const W = 88;
    const H = 24;
    const stepX = W / (data.length - 1);
    const points = data.map((v, i) => {
        const x = i * stepX;
        const y = H - (v / max) * (H - 4) - 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const last = data[data.length - 1] ?? 0;
    const lastX = (data.length - 1) * stepX;
    const lastY = H - (last / max) * (H - 4) - 2;
    return (
        <svg
            class="stat-sparkline"
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            aria-hidden="true"
            role="presentation"
        >
            <polyline
                fill="none"
                stroke={color}
                stroke-width="2"
                stroke-linejoin="round"
                stroke-linecap="round"
                points={points.join(' ')}
            />
            <circle cx={lastX.toFixed(1)} cy={lastY.toFixed(1)} r="2.5" fill={color} />
        </svg>
    );
}

interface LifecycleSteps {
    booked: boolean;     // step 1 — always true (every referral is at minimum booked)
    confirmed: boolean;  // step 2 — status not 'draft'
    onSite: boolean;     // step 3 — status in_progress / completed / delivered
    published: boolean;  // step 4 — status delivered
    paid: boolean;       // step 5 — paymentStatus paid
}

function computeSteps(r: AgentReferralRow): LifecycleSteps {
    const status = (r.status || '').toLowerCase();
    const completedOrLater = status === 'completed' || status === 'delivered';
    const onSiteOrLater = status === 'in_progress' || completedOrLater;
    const confirmedOrLater = status !== 'draft' && status !== '';
    return {
        booked:    true,
        confirmed: confirmedOrLater,
        onSite:    onSiteOrLater,
        published: status === 'delivered',
        paid:      r.paymentStatus === 'paid',
    };
}

function statusLabel(status: string): string {
    const s = (status || '').toLowerCase();
    switch (s) {
        case 'draft':       return 'Booked';
        case 'scheduled':   return 'Scheduled';
        case 'confirmed':   return 'Confirmed';
        case 'in_progress': return 'On site';
        case 'completed':   return 'Completed';
        case 'delivered':   return 'Published';
        case 'cancelled':   return 'Cancelled';
        default:            return status || 'Pending';
    }
}

/**
 * Agent Accounts A2 — cross-tenant referral dashboard.
 *
 * Frontend-design directives (non-negotiable):
 *  - Two stat cards top: "Active referrals · N" + "Reports ready to read · M"
 *  - Below: referrals grouped by tenant with a tenant-name color band header
 *    + collapsible sections (NOT a flat unified list)
 *  - Each row right-edge: lifecycle sparkline (booked → confirmed → on-site →
 *    published → paid), active step highlighted via primary color
 *
 * Sprint 1 design tokens: surface / ink / blueprint, Fraunces serif headlines,
 * DM Sans body. Markup-first; Alpine progressive enhancement only for the
 * collapse interaction.
 */
export const AgentDashboardPage = ({
    branding,
    agent,
    referrals,
    unreadReports,
    sparklineCreated,
    inspectors = [],
    bookingHost = 'inspectorhub.io',
}: AgentDashboardProps): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    const primaryColor = branding?.primaryColor || '#4f46e5';
    const greetingName = agent.name?.trim() || 'partner';
    const totalReferrals = referrals.length;

    // Group referrals by tenantId, preserving the natural order of first-seen
    // tenants (stable for tests + readable for users).
    const grouped = new Map<string, { tenantName: string; rows: AgentReferralRow[] }>();
    for (const r of referrals) {
        const bucket = grouped.get(r.tenantId);
        if (bucket) {
            bucket.rows.push(r);
        } else {
            grouped.set(r.tenantId, { tenantName: r.tenantName, rows: [r] });
        }
    }
    const tenantSections = Array.from(grouped.entries()).map(([tenantId, bucket]) => ({
        tenantId,
        tenantName: bucket.tenantName,
        rows: bucket.rows,
    }));

    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>{`Agent dashboard | ${siteName}`}</title>
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
                        transition: border-color 0.15s;
                    }
                    .topbar-link:hover { border-color: var(--cp-fg-4); }
                    .shell {
                        max-width: 1080px; margin: 0 auto;
                        padding: 1rem 1.5rem 4rem;
                    }
                    .editorial-h1 {
                        font-family: 'Fraunces', serif; font-weight: 700;
                        font-size: 2.25rem; line-height: 1.1; letter-spacing: -0.025em;
                        margin-bottom: 0.5rem;
                    }
                    .editorial-h1 em { font-style: italic; color: var(--primary); }
                    .lede {
                        font-size: 1rem; line-height: 1.55;
                        color: var(--cp-fg-2); margin-bottom: 2rem;
                    }
                    .stats {
                        display: grid; gap: 1rem;
                        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
                        margin-bottom: 2rem;
                    }
                    .stat-card {
                        background: var(--cp-bg-card);
                        border: 1px solid var(--cp-border-color);
                        border-radius: 16px;
                        padding: 1.25rem 1.5rem;
                        display: flex; flex-direction: column; gap: 0.5rem;
                        /* Tactile lift — without it the cards merge into the
                           cream page background and read as outlined boxes
                           rather than discrete tiles. Subtle to keep the
                           editorial paper feel. */
                        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.04);
                    }
                    .stat-eyebrow {
                        font-size: 0.6875rem; font-weight: 700;
                        text-transform: uppercase; letter-spacing: 0.18em;
                        color: var(--cp-fg-4);
                    }
                    .stat-value {
                        font-family: 'Fraunces', serif; font-weight: 700;
                        font-size: 2.5rem; line-height: 1; letter-spacing: -0.02em;
                        color: var(--cp-fg-1);
                    }
                    .stat-card.has-attention .stat-value { color: var(--primary); }
                    .stat-help { font-size: 0.8125rem; color: var(--cp-fg-2); }
                    /* Frontend-design polish #1 — inline sparkline on the
                       'Active referrals' card. The flex row keeps the big
                       Fraunces number anchor-left and the trend line tucked
                       to the right with breathing room. */
                    .stat-row {
                        display: flex; align-items: flex-end;
                        justify-content: space-between;
                        gap: 0.75rem;
                    }
                    .stat-sparkline {
                        opacity: 0.95;
                        margin-bottom: 0.25rem;
                    }
                    .tenant-section {
                        background: var(--cp-bg-card);
                        border: 1px solid var(--cp-border-color);
                        border-radius: 16px;
                        margin-bottom: 1rem;
                        overflow: hidden;
                    }
                    .tenant-header {
                        display: flex; align-items: center; gap: 0.75rem;
                        padding: 1rem 1.25rem;
                        cursor: pointer;
                        background: var(--cp-bg);
                        border-bottom: 1px solid var(--cp-border-color);
                    }
                    .tenant-band {
                        width: 4px; align-self: stretch;
                        border-radius: 2px;
                        background: var(--primary);
                    }
                    .tenant-name {
                        font-family: 'Fraunces', serif; font-weight: 700;
                        font-size: 1rem; letter-spacing: -0.01em;
                    }
                    .tenant-meta {
                        margin-left: auto;
                        font-size: 0.75rem; color: var(--cp-fg-4);
                        font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em;
                    }
                    .tenant-toggle {
                        font-size: 0.75rem; color: var(--cp-fg-4);
                        transition: transform 0.15s;
                    }
                    .tenant-section[data-open="false"] .tenant-toggle { transform: rotate(-90deg); }
                    .tenant-section[data-open="false"] .referrals { display: none; }
                    .referrals { display: flex; flex-direction: column; }
                    .referral-row {
                        display: grid;
                        grid-template-columns: 1fr 220px auto;
                        gap: 1rem; align-items: center;
                        padding: 1rem 1.25rem;
                        border-bottom: 1px solid var(--cp-border-color);
                        /* UC-A-4 — entire row is an <a>; strip default link styles so it
                           inherits the surface look. */
                        color: inherit;
                        text-decoration: none;
                        cursor: pointer;
                        /* Stage a left accent that fades in on hover so the
                           clickability cue reads at a glance — the cream-to-cream
                           background swap alone was too subtle. */
                        border-left: 3px solid transparent;
                        transition: background 0.15s ease, border-left-color 0.15s ease;
                    }
                    .referral-row:last-child { border-bottom: 0; }
                    .referral-row:hover {
                        background: var(--primary-soft);
                        border-left-color: var(--primary);
                    }
                    .referral-row:hover .row-cta { color: var(--primary); }
                    .referral-row:focus-visible {
                        outline: 2px solid var(--primary);
                        outline-offset: -2px;
                    }
                    .referral-main { min-width: 0; }
                    .referral-address {
                        font-weight: 600; font-size: 0.9375rem;
                        margin-bottom: 0.25rem;
                        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                    }
                    .referral-meta {
                        font-size: 0.75rem; color: var(--cp-fg-2);
                        display: flex; gap: 0.5rem; flex-wrap: wrap;
                    }
                    .referral-meta .sep { color: var(--cp-fg-4); }
                    .sparkline {
                        display: flex; align-items: center; gap: 0.25rem;
                    }
                    .sparkline-step {
                        width: 28px; height: 6px; border-radius: 3px;
                        background: var(--cp-border-color);
                        transition: background 0.15s;
                    }
                    .sparkline-step.on { background: var(--primary); }
                    .sparkline-step.on.paid { background: var(--ih-status-ok-fg); }
                    .sparkline-label {
                        font-size: 0.6875rem; font-weight: 700;
                        text-transform: uppercase; letter-spacing: 0.12em;
                        color: var(--cp-fg-4); margin-left: 0.5rem;
                    }
                    .row-cta {
                        font-size: 0.8125rem; font-weight: 600;
                        color: var(--primary); text-decoration: none;
                        padding: 0.375rem 0.75rem; border-radius: 8px;
                        border: 1px solid var(--cp-border-color);
                        transition: border-color 0.15s, background 0.15s;
                    }
                    .row-cta:hover { border-color: var(--primary); background: var(--primary-soft); }
                    .row-cta.disabled {
                        color: var(--cp-fg-4); cursor: default;
                        pointer-events: none;
                    }
                    .empty-card {
                        background: var(--cp-bg-card);
                        border: 1px solid var(--cp-border-color);
                        border-radius: 16px;
                        padding: 2.5rem 2rem;
                        color: var(--cp-fg-2);
                        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.04);
                    }
                    .empty-card h3 {
                        font-family: 'Fraunces', serif; font-weight: 600;
                        font-size: 1.5rem; color: var(--cp-fg-1);
                        margin: 0 0 0.5rem;
                        letter-spacing: -0.01em;
                    }
                    .empty-card .empty-lede {
                        margin: 0 0 2rem;
                        font-size: 0.9375rem;
                        max-width: 38em;
                    }
                    .empty-checklist {
                        list-style: none;
                        padding: 0; margin: 0;
                        display: grid; gap: 1rem;
                    }
                    .empty-checklist li {
                        display: grid;
                        grid-template-columns: 28px 1fr;
                        gap: 0.875rem;
                        padding: 1rem 1.25rem;
                        background: var(--cp-bg);
                        border: 1px solid var(--cp-border-color);
                        border-radius: 12px;
                    }
                    .empty-step-num {
                        width: 28px; height: 28px;
                        display: flex; align-items: center; justify-content: center;
                        background: var(--primary); color: #fff;
                        border-radius: 999px;
                        font-family: 'Fraunces', serif; font-weight: 700;
                        font-size: 0.875rem;
                    }
                    .empty-step-title {
                        font-weight: 600; color: var(--cp-fg-1);
                        font-size: 0.9375rem;
                        margin: 0 0 0.25rem;
                    }
                    .empty-step-body {
                        font-size: 0.8125rem;
                        color: var(--cp-fg-2);
                        margin: 0;
                    }
                    .empty-step-body a {
                        color: var(--primary); font-weight: 600;
                        text-decoration: none;
                    }
                    .empty-step-body a:hover { text-decoration: underline; }
                    @media (max-width: 700px) {
                        .referral-row {
                            grid-template-columns: 1fr;
                            gap: 0.5rem;
                        }
                        .sparkline { order: 2; }
                        .row-cta { justify-self: start; }
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
                        <a class="topbar-link" href="/agent-recommendations">Recommendations</a>
                        <a class="topbar-link" href="/agent-inspectors">Inspectors</a>
                        <a class="topbar-link" href="/agent-settings/profile">Settings</a>
                        <button id="signoutBtn" class="topbar-link" type="button">Sign out</button>
                    </nav>
                </header>

                <main class="shell">
                    <h1 class="editorial-h1">
                        Welcome, <em>{greetingName}</em>.
                    </h1>
                    <p class="lede">
                        Here are the inspections you've referred across every team you partner with.
                    </p>

                    <section class="stats" aria-label="Dashboard stats">
                        <article class="stat-card" data-testid="agent-stat-active-referrals">
                            <span class="stat-eyebrow">Active referrals</span>
                            <div class="stat-row">
                                <span class="stat-value">{totalReferrals}</span>
                                <Sparkline data={sparklineCreated ?? []} color={primaryColor} />
                            </div>
                            <span class="stat-help">
                                Across {tenantSections.length} {tenantSections.length === 1 ? 'team' : 'teams'}
                                {sparklineCreated && sparklineCreated.some((v) => v > 0)
                                    ? ` · last 7 days`
                                    : null}
                            </span>
                        </article>
                        <article
                            class={`stat-card${unreadReports > 0 ? ' has-attention' : ''}`}
                            data-testid="agent-stat-reports-ready"
                        >
                            <span class="stat-eyebrow">Reports ready to read</span>
                            <span class="stat-value">{unreadReports}</span>
                            <span class="stat-help">
                                {unreadReports === 0 ? 'You\'re all caught up' : 'Tap a row below to open'}
                            </span>
                        </article>
                    </section>

                    {tenantSections.length === 0 ? (
                        <div class="empty-card" data-testid="agent-dashboard-empty">
                            <h3>Three steps to your first referral</h3>
                            <p class="empty-lede">
                                Inspectors invite agents into their workspace from
                                their contacts list. Once you're linked, every
                                inspection you refer lands here within minutes.
                            </p>
                            <ol class="empty-checklist">
                                <li>
                                    <span class="empty-step-num">1</span>
                                    <div>
                                        <p class="empty-step-title">Pick your referral slug</p>
                                        <p class="empty-step-body">
                                            <a href="/agent-settings/profile">Choose a slug</a> like
                                            {' '}<code>jane</code> so inspectors can credit
                                            your bookings via <code>?ref=jane</code> on their
                                            booking links.
                                        </p>
                                    </div>
                                </li>
                                <li>
                                    <span class="empty-step-num">2</span>
                                    <div>
                                        <p class="empty-step-title">Confirm inspectors have your email</p>
                                        <p class="empty-step-body">
                                            Tell the inspectors you partner with that you
                                            signed up. The next inspection they tag you on
                                            will auto-link your account when the email
                                            matches their contact list.
                                        </p>
                                    </div>
                                </li>
                                <li>
                                    <span class="empty-step-num">3</span>
                                    <div>
                                        <p class="empty-step-title">Watch the next booking land here</p>
                                        <p class="empty-step-body">
                                            Each inspection your inspectors refer through
                                            you will appear in this dashboard with a one-click
                                            link to the report — no extra step.
                                        </p>
                                    </div>
                                </li>
                            </ol>
                        </div>
                    ) : (
                        tenantSections.map((section) => (
                            <article
                                class="tenant-section"
                                data-tenant-section={section.tenantId}
                                data-open="true"
                            >
                                <header
                                    class="tenant-header"
                                    role="button"
                                    tabindex={0}
                                    data-tenant-toggle={section.tenantId}
                                >
                                    <span class="tenant-band" aria-hidden="true"></span>
                                    <span class="tenant-name">{section.tenantName}</span>
                                    <span class="tenant-meta">{section.rows.length} {section.rows.length === 1 ? 'referral' : 'referrals'}</span>
                                    <span class="tenant-toggle" aria-hidden="true">▾</span>
                                </header>
                                <div class="referrals">
                                    {section.rows.map((r) => {
                                        const steps = computeSteps(r);
                                        const canViewReport = steps.published;
                                        // UC-A-4 — entire row links to /report/<id>. The route is in
                                        // isPublic allowlist (no tenant cookie required); the report's
                                        // own gate decides what to show for unpublished/draft reports.
                                        const href = canViewReport
                                            ? `/report/${r.tenantSubdomain}/${r.id}?view=agent`
                                            : `/report/${r.tenantSubdomain}/${r.id}`;
                                        return (
                                            <a
                                                class="referral-row"
                                                href={href}
                                                rel="noreferrer"
                                                data-testid={`referral-row-${r.id}`}
                                            >
                                                <div class="referral-main">
                                                    <div class="referral-address">{r.propertyAddress}</div>
                                                    <div class="referral-meta">
                                                        <span>{r.clientName ?? 'No client name'}</span>
                                                        <span class="sep">·</span>
                                                        <span>{r.date}</span>
                                                        <span class="sep">·</span>
                                                        <span>{statusLabel(r.status)}</span>
                                                        {r.inspectorName ? (
                                                            <>
                                                                <span class="sep">·</span>
                                                                <span>w/ {r.inspectorName}</span>
                                                            </>
                                                        ) : null}
                                                    </div>
                                                </div>
                                                <div
                                                    class="sparkline"
                                                    data-testid={`referral-sparkline-${r.id}`}
                                                    data-step1-on={String(steps.booked)}
                                                    data-step2-on={String(steps.confirmed)}
                                                    data-step3-on={String(steps.onSite)}
                                                    data-step4-on={String(steps.published)}
                                                    data-step5-on={String(steps.paid)}
                                                    aria-label={`Lifecycle: booked${steps.confirmed ? ', confirmed' : ''}${steps.onSite ? ', on-site' : ''}${steps.published ? ', published' : ''}${steps.paid ? ', paid' : ''}`}
                                                >
                                                    <span class={`sparkline-step${steps.booked ? ' on' : ''}`} title="Booked"></span>
                                                    <span class={`sparkline-step${steps.confirmed ? ' on' : ''}`} title="Confirmed"></span>
                                                    <span class={`sparkline-step${steps.onSite ? ' on' : ''}`} title="On site"></span>
                                                    <span class={`sparkline-step${steps.published ? ' on' : ''}`} title="Published"></span>
                                                    <span class={`sparkline-step${steps.paid ? ' on paid' : ''}`} title="Paid"></span>
                                                </div>
                                                {canViewReport ? (
                                                    <span class="row-cta">View report</span>
                                                ) : (
                                                    <span class="row-cta disabled" aria-disabled="true">Awaiting report</span>
                                                )}
                                            </a>
                                        );
                                    })}
                                </div>
                            </article>
                        ))
                    )}
                </main>

                <script src="/js/agent-dashboard.js"></script>

                {/* UC-A-6 — agent ⌘K palette. Alpine 3 is loaded `defer` so the
                    palette's vanilla x-data initializes after DOMContentLoaded. */}
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
