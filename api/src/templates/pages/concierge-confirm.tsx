import type { BrandingConfig } from '../../types/auth';

/**
 * Agent Accounts A3 — magic-link client confirmation landing page.
 *
 * Frontend-design directives (non-negotiable per plan):
 *   1. Lead with inspector photo + name + property address + scheduled date.
 *   2. Render an inline agreement-snippet preview when agreementRequired so
 *      the client knows what they're agreeing to BEFORE the e-sign step.
 *   3. Confirm CTA full-width on mobile; summary card is collapsible on small
 *      viewports so the agreement preview doesn't push the CTA below the fold.
 *
 * Sprint 1 design tokens: surface / ink / blueprint, Fraunces serif headline,
 * DM Sans body. Editorial card-first layout matching agent-invite-accept.
 */

export interface ConciergeConfirmPageProps {
    token: string;
    inspector: {
        name: string | null;
        photoUrl: string | null;
        email: string | null;
    };
    inspection: {
        propertyAddress: string;
        date: string;
        clientName: string | null;
        agreementRequired: boolean;
    };
    /** First ~280 chars of the tenant's primary agreement template, when present. */
    agreementSnippet?: string;
    branding?: BrandingConfig | undefined;
}

function initials(name: string | null | undefined): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return (parts[0]?.[0] ?? '?').toUpperCase();
    return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

export const ConciergeConfirmPage = ({
    token,
    inspector,
    inspection,
    agreementSnippet,
    branding,
}: ConciergeConfirmPageProps): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    const primaryColor = branding?.primaryColor || '#F55A1A';
    const inspectorName = inspector.name || inspector.email || 'your inspector';
    const inspectorPhoto = inspector.photoUrl;

    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>{`Confirm your inspection | ${siteName}`}</title>
                {/* Customer-portal page — follow system color preference only;
                    no localStorage / no in-page toggle (per design system). */}
                <script dangerouslySetInnerHTML={{ __html: `(function(){var p=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-color-scheme',p?'dark':'light');})()`}} />
                <link rel="stylesheet" href="/fonts.css" />
                <style dangerouslySetInnerHTML={{ __html: `
                    /* Page-local primary alias; everything else reads directly
                       from the shared --cp-* customer-portal tokens (defined
                       in input.css) so dark mode auto-swaps without a
                       second [data-color-scheme="dark"] block here. */
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
                    .wrap {
                        max-width: 640px; margin: 0 auto;
                        padding: 2.5rem 1.25rem 4rem;
                    }
                    .brand {
                        display: flex; align-items: center; gap: 0.625rem;
                        font-family: 'Fraunces', Georgia, serif;
                        font-size: 1.125rem; font-weight: 700;
                        margin-bottom: 2.5rem;
                    }
                    .summary {
                        background: var(--cp-bg-card);
                        border: 1px solid var(--cp-border-color);
                        border-radius: 14px;
                        overflow: hidden;
                    }
                    .summary-hero {
                        padding: 1.75rem 1.5rem;
                        display: flex; gap: 1rem; align-items: center;
                        border-bottom: 1px solid var(--cp-border-color);
                    }
                    .avatar {
                        width: 72px; height: 72px; border-radius: 50%;
                        background: var(--primary-soft); color: var(--primary);
                        display: flex; align-items: center; justify-content: center;
                        font-family: 'Fraunces', serif; font-size: 1.5rem; font-weight: 700;
                        flex-shrink: 0; overflow: hidden;
                    }
                    .avatar img { width: 100%; height: 100%; object-fit: cover; }
                    .hero-text .label {
                        font-size: 0.6875rem; font-weight: 700; text-transform: uppercase;
                        letter-spacing: 0.12em; color: var(--cp-fg-4); margin-bottom: 0.375rem;
                    }
                    .hero-text .name {
                        font-family: 'Fraunces', serif; font-size: 1.5rem;
                        font-weight: 700; color: var(--cp-fg-1); line-height: 1.15;
                    }
                    .summary-body { padding: 1.5rem; display: grid; gap: 0.875rem; }
                    .row { display: grid; gap: 0.25rem; }
                    .row .k {
                        font-size: 0.6875rem; font-weight: 700; text-transform: uppercase;
                        letter-spacing: 0.12em; color: var(--cp-fg-4);
                    }
                    .row .v {
                        font-size: 1rem; font-weight: 600; color: var(--cp-fg-1);
                    }
                    .agreement {
                        margin-top: 1.5rem;
                        background: var(--cp-bg-card);
                        border: 1px solid var(--cp-border-color);
                        border-radius: 14px;
                        padding: 1.5rem;
                    }
                    .agreement h3 {
                        font-family: 'Fraunces', serif; font-size: 1.125rem;
                        font-weight: 700; margin-bottom: 0.5rem; color: var(--cp-fg-1);
                    }
                    .agreement .preview-text {
                        font-size: 0.9375rem; line-height: 1.5; color: var(--cp-fg-2);
                        font-style: italic;
                    }
                    .agreement .note {
                        margin-top: 0.875rem;
                        font-size: 0.8125rem; color: var(--cp-fg-4);
                    }
                    .actions { margin-top: 1.75rem; }
                    .cta {
                        width: 100%;
                        background: var(--primary); color: #fff;
                        border: 0; padding: 0.9375rem 1.5rem; border-radius: 10px;
                        font-family: 'DM Sans', sans-serif; font-size: 1rem;
                        font-weight: 700; cursor: pointer;
                        transition: filter 0.15s ease;
                    }
                    .cta:hover { filter: brightness(0.95); }
                    .cta:disabled { background: var(--cp-fg-4); cursor: progress; }
                    .err {
                        margin-top: 0.75rem; padding: 0.75rem 1rem;
                        background: var(--ih-status-bad-bg);
                        color: var(--ih-status-bad-fg);
                        border: 1px solid var(--ih-status-bad);
                        border-radius: 8px;
                        font-size: 0.875rem;
                    }
                    .summary-toggle { display: none; }
                    @media (max-width: 600px) {
                        .summary-toggle {
                            display: block; width: 100%; text-align: left;
                            padding: 0.75rem 1.5rem;
                            background: var(--cp-bg-card);
                            border-top: 1px solid var(--cp-border-color);
                            font-size: 0.875rem; color: var(--cp-fg-2); cursor: pointer;
                            border-left: 0; border-right: 0; border-bottom: 0;
                        }
                    }
                `}} />
            </head>
            <body>
                <main class="wrap">
                    <div class="brand">
                        <span style={`width: 32px; height: 32px; border-radius: 8px; background: ${primaryColor}; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700;`}>{siteName.charAt(0)}</span>
                        <span>{siteName}</span>
                    </div>

                    <h1 style="font-family: 'Fraunces', serif; font-size: 2rem; font-weight: 700; line-height: 1.15; margin-bottom: 0.5rem;">
                        Confirm your inspection
                    </h1>
                    <p style="font-size: 1rem; color: var(--cp-fg-2); margin-bottom: 2rem; line-height: 1.5;">
                        {inspector.name ? <strong>{inspector.name}</strong> : 'Your inspector'} has scheduled an inspection on your behalf.
                        Review the details below and confirm to lock it in.
                    </p>

                    <article class="summary" data-testid="summary-card">
                        <div class="summary-hero">
                            {inspectorPhoto ? (
                                <span class="avatar">
                                    <img src={inspectorPhoto} alt={inspectorName} />
                                </span>
                            ) : (
                                <span class="avatar" data-initials={initials(inspector.name)}>
                                    {initials(inspector.name)}
                                </span>
                            )}
                            <div class="hero-text">
                                <div class="label">Your inspector</div>
                                <div class="name">{inspectorName}</div>
                            </div>
                        </div>
                        <div class="summary-body">
                            <div class="row">
                                <span class="k">Property</span>
                                <span class="v">{inspection.propertyAddress}</span>
                            </div>
                            <div class="row">
                                <span class="k">Date</span>
                                <span class="v">{inspection.date}</span>
                            </div>
                            {inspection.clientName ? (
                                <div class="row">
                                    <span class="k">Client</span>
                                    <span class="v">{inspection.clientName}</span>
                                </div>
                            ) : null}
                        </div>
                    </article>

                    {inspection.agreementRequired && agreementSnippet ? (
                        <section class="agreement" data-testid="agreement-preview">
                            <h3>Inspection agreement (preview)</h3>
                            <p class="preview-text">{agreementSnippet}</p>
                            <p class="note">After confirming you'll be taken to the full agreement to read and e-sign.</p>
                        </section>
                    ) : null}
                    {inspection.agreementRequired && !agreementSnippet ? (
                        <section class="agreement" data-testid="agreement-preview">
                            <h3>Inspection agreement</h3>
                            <p class="preview-text">After confirming you'll be taken to the full inspection agreement to read and e-sign.</p>
                        </section>
                    ) : null}

                    <form id="confirmForm" class="actions">
                        <input type="hidden" name="token" value={token} />
                        <button type="submit" class="cta" data-testid="confirm-btn">
                            Confirm and continue
                        </button>
                        <div id="errBox" class="err" style="display: none;"></div>
                    </form>

                    <script dangerouslySetInnerHTML={{ __html: `
                        (function() {
                            var form = document.getElementById('confirmForm');
                            var btn  = form.querySelector('button');
                            var err  = document.getElementById('errBox');
                            form.addEventListener('submit', function(ev) {
                                ev.preventDefault();
                                err.style.display = 'none';
                                btn.disabled = true;
                                btn.textContent = 'Confirming...';
                                fetch('/api/concierge/confirm', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ token: ${JSON.stringify(token)} }),
                                    credentials: 'same-origin'
                                }).then(function(r) {
                                    return r.json().then(function(j) { return { status: r.status, body: j }; });
                                }).then(function(out) {
                                    if (out.status === 200 && out.body && out.body.success) {
                                        var redirect = (out.body.data && out.body.data.redirect) || '/';
                                        window.location.assign(redirect);
                                        return;
                                    }
                                    var msg = (out.body && out.body.error && out.body.error.message) || 'Could not confirm. Please try again.';
                                    err.textContent = msg;
                                    err.style.display = 'block';
                                    btn.disabled = false;
                                    btn.textContent = 'Confirm and continue';
                                }).catch(function() {
                                    err.textContent = 'Network error. Please try again.';
                                    err.style.display = 'block';
                                    btn.disabled = false;
                                    btn.textContent = 'Confirm and continue';
                                });
                            });
                        })();
                    `}} />
                </main>
            </body>
        </html>
    );
};
