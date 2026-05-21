import type { BrandingConfig } from '../../types/auth';

/**
 * Agent Accounts A3 — Friendly recovery page for expired / unknown / used
 * concierge confirm tokens. Mirrors the warm tone of agent-invite-expired.
 */
export interface ConciergeConfirmExpiredPageProps {
    reason: 'unknown' | 'expired' | 'no-token';
    branding?: BrandingConfig | undefined;
}

export const ConciergeConfirmExpiredPage = ({
    reason,
    branding,
}: ConciergeConfirmExpiredPageProps): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    const primaryColor = branding?.primaryColor || '#F55A1A';
    const headline =
        reason === 'expired'
            ? 'This confirmation link has expired'
            : reason === 'unknown'
              ? "We couldn't find that confirmation link"
              : 'No confirmation link provided';
    const body =
        reason === 'expired'
            ? 'Confirmation links are valid for 7 days. Reach out to your agent or inspector and they can send you a fresh one in a minute.'
            : reason === 'unknown'
              ? 'The link may have been mistyped, or the booking was cancelled. Get in touch with your agent — they can reissue a new confirmation.'
              : 'It looks like the link is incomplete. Use the original email and try again, or contact your agent.';
    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>{`Confirmation link unavailable | ${siteName}`}</title>
                {/* Customer-portal page — follow system color preference only;
                    no localStorage / no in-page toggle (per design system). */}
                <script dangerouslySetInnerHTML={{ __html: `(function(){var p=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-color-scheme',p?'dark':'light');})()`}} />
                <link rel="stylesheet" href="/fonts.css" />
                <style dangerouslySetInnerHTML={{ __html: `
                    /* Customer-portal page — uses the warm --cp-* tokens
                       defined in input.css (auto-swap to warm-dark via the
                       [data-color-scheme="dark"] attribute set by FOUC). */
                    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
                    body {
                        font-family: 'DM Sans', system-ui, sans-serif;
                        background: var(--cp-bg); color: var(--cp-fg-1);
                        min-height: 100vh; display: flex; align-items: center; justify-content: center;
                        padding: 2rem 1.25rem;
                    }
                    .card {
                        background: var(--cp-bg-card); border: var(--cp-border);
                        border-radius: 14px; padding: 2.25rem 1.75rem;
                        max-width: 480px; width: 100%;
                    }
                    h1 {
                        font-family: 'Fraunces', Georgia, serif;
                        font-size: 1.5rem; font-weight: 700;
                        line-height: 1.2; margin-bottom: 0.625rem;
                    }
                    p { font-size: 0.9375rem; color: var(--cp-fg-2); line-height: 1.55; }
                    .icon {
                        width: 48px; height: 48px; border-radius: 12px;
                        background: ${primaryColor}26; color: ${primaryColor};
                        display: flex; align-items: center; justify-content: center;
                        font-size: 1.5rem; margin-bottom: 1rem;
                    }
                `}} />
            </head>
            <body>
                <main class="card">
                    <div class="icon">!</div>
                    <h1>{headline}</h1>
                    <p>{body}</p>
                </main>
            </body>
        </html>
    );
};
