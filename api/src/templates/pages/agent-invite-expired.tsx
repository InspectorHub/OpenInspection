import type { BrandingConfig } from '../../types/auth';

export interface AgentInviteExpiredProps {
    reason: 'expired' | 'used' | 'no-token' | 'unknown';
    inviterName?: string;
    inviterEmail?: string;
    tenantName?: string;
    branding?: BrandingConfig;
}

/**
 * Agent Accounts A1 — friendly recovery for expired / unknown / no-token invites.
 *
 * Frontend-design directive 2: don't dead-end the user. Offer "Ask {Inspector}
 * to send a new invite" with an auto-prefilled mailto button, plus a clear
 * /agent-signup escape hatch.
 */
export const AgentInviteExpiredPage = ({
    reason,
    inviterName,
    inviterEmail,
    tenantName,
    branding,
}: AgentInviteExpiredProps): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    const primaryColor = branding?.primaryColor || '#4f46e5';
    const inspector = inviterName || 'the inspector who invited you';
    const subject = `Could you re-send my partner agent invite?`;
    const bodyLines = [
        `Hi${inviterName ? ' ' + inviterName : ''},`,
        '',
        `My partner-agent invite to ${tenantName || siteName} expired before I could accept it. Could you re-send it?`,
        '',
        'Thanks!',
    ];
    // Don't URL-encode the email part — `mailto:` accepts a bare address. Only the
    // subject and body need percent-encoding.
    const mailto = inviterEmail
        ? `mailto:${inviterEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join('\n'))}`
        : null;

    const headline =
        reason === 'used'
            ? 'This invite has already been used'
            : reason === 'no-token'
                ? 'No invite token in this link'
                : 'This invite has expired';

    const explainer =
        reason === 'used'
            ? 'Looks like this invite has already been claimed. If that wasn\'t you, ask the inspector to resend.'
            : reason === 'no-token'
                ? 'The link is missing the invite token. Most likely the email got mangled in transit. Ask the inspector to copy the full link.'
                : 'Invites expire after seven days. Ask the inspector for a fresh one — the link below pre-fills the message.';

    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>{`Invite expired | ${siteName}`}</title>
                <script dangerouslySetInnerHTML={{ __html: `(function(){try{var L=localStorage.getItem('ih-color-scheme');if(L&&!localStorage.getItem('oi-color-scheme'))localStorage.setItem('oi-color-scheme',L);if(L)localStorage.removeItem('ih-color-scheme');}catch(e){}var s=localStorage.getItem('oi-color-scheme');var p=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-color-scheme',s==='dark'||(s===null&&p)?'dark':'light');})()`}} />
                <link rel="stylesheet" href="/fonts.css" />
                <style dangerouslySetInnerHTML={{ __html: `
                    :root {
                        --badge-bg: #fef3c7;
                        --badge-fg: #92400e;
                    }
                    html[data-color-scheme="dark"] {
                        --badge-bg: rgba(251,191,36,0.18);
                        --badge-fg: #fbbf24;
                    }
                    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
                    body {
                        font-family: 'DM Sans', system-ui, sans-serif;
                        background: var(--cp-bg);
                        color: var(--cp-fg-1);
                        min-height: 100vh;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        padding: 2rem 1.5rem;
                        -webkit-font-smoothing: antialiased;
                    }
                    .card {
                        max-width: 480px;
                        width: 100%;
                        background: var(--cp-bg-card);
                        border: 1px solid var(--cp-border-color);
                        border-radius: 18px;
                        padding: 2.5rem 2rem;
                        text-align: center;
                    }
                    .badge {
                        display: inline-flex;
                        align-items: center;
                        gap: 0.375rem;
                        padding: 0.375rem 0.875rem;
                        background: var(--badge-bg);
                        color: var(--badge-fg);
                        border-radius: 999px;
                        font-size: 0.75rem;
                        font-weight: 600;
                        text-transform: uppercase;
                        letter-spacing: 0.06em;
                        margin-bottom: 1.25rem;
                    }
                    h1 {
                        font-family: 'Fraunces', serif;
                        font-weight: 700;
                        font-size: 1.75rem;
                        line-height: 1.2;
                        letter-spacing: -0.02em;
                        margin-bottom: 0.75rem;
                    }
                    .explainer {
                        color: var(--cp-fg-2);
                        font-size: 0.9375rem;
                        line-height: 1.55;
                        margin-bottom: 1.75rem;
                    }
                    .cta {
                        display: inline-block;
                        padding: 0.75rem 1.5rem;
                        background: ${primaryColor};
                        color: #ffffff;
                        font-weight: 600;
                        text-decoration: none;
                        border-radius: 12px;
                        font-size: 0.9375rem;
                        transition: opacity 0.15s;
                    }
                    .cta:hover { opacity: 0.92; }
                    .secondary {
                        display: block;
                        margin-top: 1.25rem;
                        font-size: 0.875rem;
                        color: var(--cp-fg-4);
                        text-decoration: none;
                    }
                    .secondary:hover { color: var(--cp-fg-1); }
                ` }} />
            </head>
            <body>
                <div class="card">
                    <span class="badge">Invite needs a refresh</span>
                    <h1>{headline}</h1>
                    <p class="explainer">{explainer}</p>
                    {mailto ? (
                        <a class="cta" href={mailto} data-testid="ask-for-new-invite">
                            Ask {inspector} for a new invite
                        </a>
                    ) : (
                        <a class="cta" href="/agent-signup">Sign up directly instead</a>
                    )}
                    <a class="secondary" href="/agent-signup" data-testid="signup-fallback">
                        Or sign up directly without an invite
                    </a>
                </div>
            </body>
        </html>
    );
};
