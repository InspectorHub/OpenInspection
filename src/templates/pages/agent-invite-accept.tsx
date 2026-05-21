import type { BrandingConfig } from '../../types/auth';

export interface AgentInviteAcceptProps {
    token: string;
    inspector: { name: string; photoUrl?: string };
    tenantName: string;
    inviteEmail: string;
    branding?: BrandingConfig;
}

/**
 * Agent Accounts A1 — public invite acceptance landing.
 *
 * Frontend-design directives (from plan):
 *   1. Lead with inspector photo + name + tenant — personal, not transactional.
 *   2. Below: 3 value-prop icons + tagline (Real-time referrals · Cross-tenant
 *      view · Free).
 *   3. Then the accept-form. Email is pre-filled + readonly so the recipient
 *      can't retarget the invite.
 */
export const AgentInviteAcceptPage = ({
    token,
    inspector,
    tenantName,
    inviteEmail,
    branding,
}: AgentInviteAcceptProps): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    const primaryColor = branding?.primaryColor || '#4f46e5';
    const inspectorInitials = inspector.name
        .split(/\s+/)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join('')
        .slice(0, 2);

    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>{`You're invited | ${siteName}`}</title>
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
                    .invite-shell {
                        max-width: 540px;
                        margin: 0 auto;
                        padding: 3.5rem 1.5rem 4rem;
                    }
                    .brand-row {
                        display: flex;
                        align-items: center;
                        gap: 0.75rem;
                        margin-bottom: 2.5rem;
                    }
                    .brand-row img { width: 32px; height: 32px; object-fit: contain; }
                    .brand-name {
                        font-family: 'Fraunces', serif;
                        font-weight: 700;
                        font-size: 1.125rem;
                        letter-spacing: -0.02em;
                    }
                    .editorial-h1 {
                        font-family: 'Fraunces', serif;
                        font-weight: 700;
                        font-size: 2.25rem;
                        line-height: 1.15;
                        letter-spacing: -0.02em;
                        margin-bottom: 0.75rem;
                    }
                    .lede {
                        font-size: 1rem;
                        line-height: 1.55;
                        color: var(--cp-fg-2);
                        margin-bottom: 2.25rem;
                    }

                    /* Inspector hero band */
                    .inspector-card {
                        display: flex;
                        align-items: center;
                        gap: 1rem;
                        padding: 1.25rem;
                        background: var(--cp-bg-card);
                        border: 1px solid var(--cp-border-color);
                        border-radius: 16px;
                        margin-bottom: 2rem;
                    }
                    .inspector-avatar {
                        width: 56px;
                        height: 56px;
                        border-radius: 50%;
                        background: var(--primary-soft);
                        color: var(--primary);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-family: 'Fraunces', serif;
                        font-weight: 700;
                        font-size: 1.25rem;
                        flex-shrink: 0;
                        overflow: hidden;
                    }
                    .inspector-avatar img {
                        width: 100%; height: 100%; object-fit: cover; border-radius: 50%;
                    }
                    .inspector-name {
                        font-weight: 600;
                        font-size: 1rem;
                        color: var(--cp-fg-1);
                    }
                    .inspector-tenant {
                        font-size: 0.875rem;
                        color: var(--cp-fg-2);
                        margin-top: 0.125rem;
                    }

                    /* Value-prop row */
                    .value-row {
                        display: grid;
                        grid-template-columns: repeat(3, 1fr);
                        gap: 0.75rem;
                        margin-bottom: 2.25rem;
                    }
                    @media (max-width: 480px) {
                        .value-row { grid-template-columns: 1fr; }
                    }
                    .value-card {
                        padding: 1rem 0.875rem;
                        background: var(--cp-bg-card);
                        border: 1px solid var(--cp-border-color);
                        border-radius: 12px;
                        text-align: center;
                    }
                    .value-icon {
                        font-size: 1.5rem;
                        line-height: 1;
                        margin-bottom: 0.5rem;
                    }
                    .value-label {
                        font-size: 0.8125rem;
                        font-weight: 600;
                        color: var(--cp-fg-1);
                        line-height: 1.3;
                    }
                    .value-sub {
                        font-size: 0.75rem;
                        color: var(--cp-fg-4);
                        margin-top: 0.25rem;
                        line-height: 1.4;
                    }

                    /* Form */
                    .form-group { margin-top: 1.25rem; }
                    .form-label {
                        display: block;
                        font-size: 0.8125rem;
                        font-weight: 600;
                        color: var(--cp-fg-2);
                        margin-bottom: 0.5rem;
                    }
                    .form-input {
                        width: 100%;
                        padding: 0.75rem 1rem;
                        font-size: 0.9375rem;
                        font-family: inherit;
                        color: var(--cp-fg-1);
                        background: var(--cp-bg-card);
                        border: 1.5px solid var(--cp-border-color);
                        border-radius: 12px;
                        outline: none;
                        transition: border-color 0.15s, box-shadow 0.15s;
                    }
                    .form-input:focus {
                        border-color: var(--primary);
                        box-shadow: 0 0 0 3px var(--primary-soft);
                    }
                    .form-input[readonly] {
                        background: var(--cp-bg-muted);
                        color: var(--cp-fg-2);
                        cursor: not-allowed;
                    }
                    .submit-btn {
                        width: 100%;
                        margin-top: 1.75rem;
                        padding: 0.875rem 1.5rem;
                        font-family: inherit;
                        font-size: 0.9375rem;
                        font-weight: 600;
                        color: #fff;
                        background: var(--primary);
                        border: none;
                        border-radius: 12px;
                        cursor: pointer;
                        transition: opacity 0.15s, transform 0.1s;
                    }
                    .submit-btn:hover { opacity: 0.92; }
                    .submit-btn:active { transform: scale(0.985); }
                    .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
                    .error-box {
                        margin-top: 1rem;
                        padding: 0.75rem 1rem;
                        border-radius: 10px;
                        background: var(--ih-status-bad-bg);
                        border: 1px solid var(--ih-status-bad);
                        color: var(--ih-status-bad-fg);
                        font-size: 0.875rem;
                    }
                    .error-box.hidden { display: none; }
                    .footer-note {
                        margin-top: 2.5rem;
                        font-size: 0.75rem;
                        color: var(--cp-fg-4);
                        text-align: center;
                        line-height: 1.6;
                    }
                ` }} />
            </head>
            <body>
                <div class="invite-shell">
                    <div class="brand-row">
                        {branding?.logoUrl ? <img src={branding.logoUrl} alt={siteName} /> : null}
                        <span class="brand-name">{siteName}</span>
                    </div>

                    <h1 class="editorial-h1">You're invited</h1>
                    <p class="lede">
                        <strong>{inspector.name}</strong> at <strong>{tenantName}</strong>{' '}
                        has invited you to be a partner agent. See every inspection your
                        inspectors complete for the clients you refer.
                    </p>

                    {/* Inspector hero band — directive 1 */}
                    <div class="inspector-card" data-testid="inspector-hero">
                        <div class="inspector-avatar">
                            {inspector.photoUrl
                                ? <img src={inspector.photoUrl} alt={inspector.name} />
                                : <span>{inspectorInitials}</span>}
                        </div>
                        <div>
                            <div class="inspector-name">{inspector.name}</div>
                            <div class="inspector-tenant">{tenantName}</div>
                        </div>
                    </div>

                    {/* Three value props — directive 1 */}
                    <div class="value-row">
                        <div class="value-card" data-testid="value-prop-1">
                            <div class="value-icon">{'↗'}</div>
                            <div class="value-label">Real-time referrals</div>
                            <div class="value-sub">See reports the moment they're ready</div>
                        </div>
                        <div class="value-card" data-testid="value-prop-2">
                            <div class="value-icon">{'⊕'}</div>
                            <div class="value-label">Cross-tenant view</div>
                            <div class="value-sub">All your inspectors, one dashboard</div>
                        </div>
                        <div class="value-card" data-testid="value-prop-3">
                            <div class="value-icon">{'★'}</div>
                            <div class="value-label">Free</div>
                            <div class="value-sub">No fees, no card on file</div>
                        </div>
                    </div>

                    <form id="acceptForm" autocomplete="off">
                        <input type="hidden" name="token" value={token} />
                        <div class="form-group">
                            <label class="form-label" for="email">Email</label>
                            <input
                                class="form-input"
                                type="email"
                                id="email"
                                name="email"
                                value={inviteEmail}
                                readonly
                            />
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="name">Your full name</label>
                            <input
                                class="form-input"
                                type="text"
                                id="name"
                                name="name"
                                placeholder="Jane Smith"
                                required
                                minlength={2}
                            />
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="password">Create a password</label>
                            <input
                                class="form-input"
                                type="password"
                                id="password"
                                name="password"
                                placeholder="At least 12 characters"
                                required
                                minlength={12}
                            />
                        </div>
                        <button type="submit" class="submit-btn" id="submitBtn">
                            Accept invitation
                        </button>
                        <div id="errorBox" class="error-box hidden"></div>
                    </form>

                    <p class="footer-note">
                        By accepting you agree to receive notifications when your referrals
                        are inspected. You can unsubscribe at any time.
                    </p>
                </div>

                <script dangerouslySetInnerHTML={{ __html: `
                    (function () {
                        const form = document.getElementById('acceptForm');
                        const btn = document.getElementById('submitBtn');
                        const err = document.getElementById('errorBox');
                        if (!form || !btn || !err) return;
                        form.addEventListener('submit', async function (e) {
                            e.preventDefault();
                            err.classList.add('hidden');
                            err.textContent = '';
                            btn.disabled = true;
                            btn.textContent = 'Setting up your account…';
                            try {
                                const fd = new FormData(form);
                                const res = await fetch('/api/agents/accept', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    credentials: 'same-origin',
                                    body: JSON.stringify({
                                        token: fd.get('token'),
                                        password: fd.get('password'),
                                        name: fd.get('name'),
                                    }),
                                });
                                const json = await res.json().catch(function () { return {}; });
                                if (!res.ok || !json.success) {
                                    throw new Error((json && json.error && json.error.message) || 'Could not accept invite');
                                }
                                const redirect = (json.data && json.data.redirect) || '/agent-dashboard';
                                window.location.href = redirect;
                            } catch (e2) {
                                err.textContent = (e2 && e2.message) || 'Something went wrong';
                                err.classList.remove('hidden');
                                btn.disabled = false;
                                btn.textContent = 'Accept invitation';
                            }
                        });
                    })();
                ` }} />
            </body>
        </html>
    );
};
