import type { BrandingConfig } from '../../types/auth';

export interface AgentSignupProps {
    siteKey?: string | undefined;
    branding?: BrandingConfig | undefined;
}

/**
 * Agent Accounts A1 — self-serve agent signup.
 *
 * Frontend-design directive 3: split-screen hero (50/50 desktop, stacked mobile).
 * Left half: editorial value-prop ("See every inspection your inspectors completed
 * for clients you referred · Subscribe to availability calendars · Free forever").
 * Right half: form. A bare form alone reads spam.
 */
export const AgentSignupPage = ({ siteKey, branding }: AgentSignupProps = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    const primaryColor = branding?.primaryColor || '#4f46e5';

    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>{`Become a partner agent | ${siteName}`}</title>
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
                        display: flex;
                        -webkit-font-smoothing: antialiased;
                    }

                    /* Split layout — stacks on mobile */
                    .signup-shell {
                        display: grid;
                        grid-template-columns: 1fr;
                        width: 100%;
                        min-height: 100vh;
                    }
                    @media (min-width: 1024px) {
                        .signup-shell {
                            grid-template-columns: 1fr 1fr;
                        }
                    }

                    /* Left: editorial value-prop. Uses the shared
                       --cp-hero-bg / --cp-hero-fg tokens (also used by
                       inspector-profile's trust-strip) so the marketing
                       hero shares one warm-dark palette across the
                       customer-portal + agent surfaces. Flat fill +
                       the existing radial accent (::before) — no
                       linear-gradient (single brand gradient rule). */
                    .value-pane {
                        display: flex;
                        flex-direction: column;
                        justify-content: center;
                        padding: 3rem 2rem;
                        background: var(--cp-hero-bg);
                        color: var(--cp-hero-fg);
                        position: relative;
                        overflow: hidden;
                    }
                    .value-pane::before {
                        content: '';
                        position: absolute;
                        width: 480px;
                        height: 480px;
                        right: -120px;
                        top: -160px;
                        background: var(--primary);
                        filter: blur(140px);
                        opacity: 0.35;
                    }
                    .value-content {
                        position: relative;
                        z-index: 1;
                        max-width: 460px;
                        margin: 0 auto;
                    }
                    .brand-row {
                        display: flex;
                        align-items: center;
                        gap: 0.75rem;
                        margin-bottom: 3rem;
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
                        font-size: 2.75rem;
                        line-height: 1.05;
                        letter-spacing: -0.025em;
                        margin-bottom: 1.25rem;
                    }
                    .lede {
                        font-size: 1rem;
                        line-height: 1.55;
                        color: #d6d3d1;
                        margin-bottom: 2rem;
                    }
                    .value-list { list-style: none; }
                    .value-item {
                        display: flex;
                        gap: 0.875rem;
                        padding: 1rem 0;
                        border-top: 1px solid rgba(255,255,255,0.08);
                    }
                    .value-item:last-child { border-bottom: 1px solid rgba(255,255,255,0.08); }
                    .value-bullet {
                        width: 28px;
                        height: 28px;
                        border-radius: 50%;
                        background: var(--primary);
                        color: #fff;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 0.75rem;
                        flex-shrink: 0;
                        margin-top: 0.125rem;
                        font-weight: 700;
                    }
                    .value-text { font-size: 0.9375rem; line-height: 1.55; color: #e7e5e4; }
                    .value-text strong { color: #ffffff; font-weight: 600; }

                    /* Right: form */
                    .form-pane {
                        display: flex;
                        flex-direction: column;
                        justify-content: center;
                        padding: 3rem 2rem;
                    }
                    .form-content {
                        max-width: 420px;
                        width: 100%;
                        margin: 0 auto;
                    }
                    .form-h2 {
                        font-size: 1.5rem;
                        font-weight: 700;
                        letter-spacing: -0.02em;
                        margin-bottom: 0.5rem;
                    }
                    .form-sub {
                        color: var(--cp-fg-2);
                        font-size: 0.9375rem;
                        line-height: 1.55;
                        margin-bottom: 2rem;
                    }
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
                    .login-link {
                        display: block;
                        margin-top: 1.5rem;
                        font-size: 0.875rem;
                        color: var(--cp-fg-2);
                        text-align: center;
                    }
                    .login-link a {
                        color: var(--primary);
                        font-weight: 500;
                        text-decoration: none;
                    }
                    .login-link a:hover { text-decoration: underline; }
                ` }} />
                {siteKey ? <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script> : null}
            </head>
            <body>
                <div class="signup-shell">
                    <aside class="value-pane" data-testid="signup-value-prop">
                        <div class="value-content">
                            <div class="brand-row">
                                {branding?.logoUrl ? <img src={branding.logoUrl} alt={siteName} /> : null}
                                <span class="brand-name">{siteName}</span>
                            </div>
                            <h1 class="editorial-h1">Become a partner agent</h1>
                            <p class="lede">
                                The free way for real-estate agents to track every inspection
                                their inspectors completed for clients they referred.
                            </p>
                            <ul class="value-list">
                                <li class="value-item">
                                    <span class="value-bullet">{'1'}</span>
                                    <span class="value-text">
                                        <strong>See every referred inspection.</strong> One dashboard,
                                        every inspector you work with.
                                    </span>
                                </li>
                                <li class="value-item">
                                    <span class="value-bullet">{'2'}</span>
                                    <span class="value-text">
                                        <strong>Subscribe to availability.</strong> Calendar feeds keep
                                        the dates your inspectors are open in your own calendar app.
                                    </span>
                                </li>
                                <li class="value-item">
                                    <span class="value-bullet">{'3'}</span>
                                    <span class="value-text">
                                        <strong>Free forever.</strong> No fees, no card on file. Your
                                        inspectors pay for the platform.
                                    </span>
                                </li>
                            </ul>
                        </div>
                    </aside>

                    <section class="form-pane">
                        <div class="form-content">
                            <h2 class="form-h2">Create your free account</h2>
                            <p class="form-sub">
                                Takes about a minute. Already invited? Use the link in your email
                                instead — it pre-fills the right tenant.
                            </p>
                            <form id="signupForm" data-testid="signup-form" autocomplete="off">
                                <div class="form-group">
                                    <label class="form-label" for="name">Full name</label>
                                    <input class="form-input" type="text" id="name" name="name" placeholder="Jane Smith" required minlength={2} />
                                </div>
                                <div class="form-group">
                                    <label class="form-label" for="email">Work email</label>
                                    <input class="form-input" type="email" id="email" name="email" placeholder="jane@realty.com" required />
                                </div>
                                <div class="form-group">
                                    <label class="form-label" for="password">Password</label>
                                    <input class="form-input" type="password" id="password" name="password" placeholder="At least 12 characters" required minlength={12} />
                                </div>
                                {siteKey ? (
                                    <div class="form-group">
                                        <div class="cf-turnstile" data-sitekey={siteKey} data-callback="onTurnstileSuccess"></div>
                                    </div>
                                ) : null}
                                <button type="submit" class="submit-btn" id="submitBtn">
                                    Create account
                                </button>
                                <div id="errorBox" class="error-box hidden"></div>
                            </form>
                            <p class="login-link">
                                Already have an account? <a href="/login">Sign in</a>
                            </p>
                        </div>
                    </section>
                </div>

                <script dangerouslySetInnerHTML={{ __html: `
                    (function () {
                        let turnstileToken = '';
                        window.onTurnstileSuccess = function (t) { turnstileToken = t; };
                        const form = document.getElementById('signupForm');
                        const btn = document.getElementById('submitBtn');
                        const err = document.getElementById('errorBox');
                        if (!form || !btn || !err) return;
                        form.addEventListener('submit', async function (e) {
                            e.preventDefault();
                            err.classList.add('hidden');
                            err.textContent = '';
                            btn.disabled = true;
                            btn.textContent = 'Creating account…';
                            try {
                                const fd = new FormData(form);
                                const res = await fetch('/api/agent-signup', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    credentials: 'same-origin',
                                    body: JSON.stringify({
                                        email: fd.get('email'),
                                        password: fd.get('password'),
                                        name: fd.get('name'),
                                        turnstileToken: turnstileToken || undefined,
                                    }),
                                });
                                const json = await res.json().catch(function () { return {}; });
                                if (!res.ok || !json.success) {
                                    if (json && json.error && json.error.code === 'conflict') {
                                        err.innerHTML = 'That email is already registered. <a href="/login">Sign in instead</a>.';
                                    } else {
                                        err.textContent = (json && json.error && json.error.message) || 'Could not create account';
                                    }
                                    throw new Error('aborted');
                                }
                                const redirect = (json.data && json.data.redirect) || '/agent-dashboard';
                                window.location.href = redirect;
                            } catch (e2) {
                                err.classList.remove('hidden');
                                btn.disabled = false;
                                btn.textContent = 'Create account';
                            }
                        });
                    })();
                ` }} />
            </body>
        </html>
    );
};
