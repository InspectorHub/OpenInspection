import { BrandingConfig } from '../../types/auth';

export const LoginPage = ({ branding }: { branding?: BrandingConfig | undefined } = {}): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    const primaryColor = branding?.primaryColor || '#6366f1';
    const logoUrl = branding?.logoUrl;
    const gaMeasurementId = branding?.gaMeasurementId;

    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>{`Sign in | ${siteName}`}</title>
                <link rel="stylesheet" href="/fonts.css" />
                <style dangerouslySetInnerHTML={{ __html: `
                    :root {
                        --primary: ${primaryColor};
                        --primary-light: ${primaryColor}18;
                    }
                    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
                    body {
                        font-family: 'DM Sans', system-ui, sans-serif;
                        background: #fafaf9;
                        color: #1c1917;
                        min-height: 100vh;
                        display: flex;
                        -webkit-font-smoothing: antialiased;
                    }

                    /* ---- Split layout ---- */
                    .split-left {
                        flex: 1 1 50%;
                        display: flex;
                        flex-direction: column;
                        justify-content: center;
                        align-items: center;
                        padding: 2.5rem;
                        position: relative;
                    }
                    .split-right {
                        flex: 1 1 50%;
                        display: none;
                        position: relative;
                        overflow: hidden;
                    }
                    @media (min-width: 1024px) {
                        .split-right { display: flex; }
                    }

                    /* ---- Right panel ---- */
                    .panel-bg {
                        position: absolute;
                        inset: 0;
                        background: linear-gradient(145deg, #1c1917 0%, #292524 50%, #1c1917 100%);
                    }
                    .panel-grid {
                        position: absolute;
                        inset: 0;
                        background-image:
                            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
                        background-size: 48px 48px;
                    }
                    .panel-accent {
                        position: absolute;
                        width: 340px;
                        height: 340px;
                        border-radius: 50%;
                        filter: blur(100px);
                        opacity: 0.4;
                        background: var(--primary);
                    }
                    .panel-content {
                        position: relative;
                        z-index: 1;
                        display: flex;
                        flex-direction: column;
                        justify-content: center;
                        align-items: center;
                        width: 100%;
                        height: 100%;
                        padding: 4rem;
                        color: #fafaf9;
                    }
                    .panel-content h2 {
                        font-family: 'Fraunces', serif;
                        font-weight: 700;
                        font-size: 2.5rem;
                        line-height: 1.2;
                        text-align: center;
                        max-width: 420px;
                        letter-spacing: -0.02em;
                    }
                    .panel-content p {
                        margin-top: 1.25rem;
                        color: #a8a29e;
                        text-align: center;
                        max-width: 340px;
                        line-height: 1.7;
                        font-size: 0.9375rem;
                    }
                    .stat-row {
                        display: flex;
                        gap: 3rem;
                        margin-top: 3.5rem;
                        padding-top: 2.5rem;
                        border-top: 1px solid rgba(255,255,255,0.08);
                    }
                    .stat-item { text-align: center; }
                    .stat-value {
                        font-family: 'Fraunces', serif;
                        font-size: 2rem;
                        font-weight: 700;
                        color: #fafaf9;
                        letter-spacing: -0.03em;
                    }
                    .stat-label {
                        margin-top: 0.25rem;
                        font-size: 0.75rem;
                        text-transform: uppercase;
                        letter-spacing: 0.12em;
                        color: #78716c;
                    }

                    /* ---- Login card ---- */
                    .login-wrap {
                        width: 100%;
                        max-width: 400px;
                    }
                    .brand-mark {
                        display: flex;
                        align-items: center;
                        gap: 0.875rem;
                        margin-bottom: 3rem;
                    }
                    .brand-icon {
                        width: 44px;
                        height: 44px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        flex-shrink: 0;
                    }
                    .brand-icon img {
                        width: 100%;
                        height: 100%;
                        object-fit: contain;
                    }
                    .brand-name {
                        font-family: 'Fraunces', serif;
                        font-weight: 700;
                        font-size: 1.375rem;
                        letter-spacing: -0.03em;
                        color: #1c1917;
                    }
                    .login-heading {
                        font-size: 1.625rem;
                        font-weight: 700;
                        letter-spacing: -0.02em;
                        color: #1c1917;
                        line-height: 1.25;
                    }
                    .login-sub {
                        margin-top: 0.5rem;
                        color: #78716c;
                        font-size: 0.9375rem;
                        line-height: 1.6;
                    }

                    /* ---- Form ---- */
                    .form-group { margin-top: 2rem; }
                    .form-group + .form-group { margin-top: 1.25rem; }
                    .form-label {
                        display: block;
                        font-size: 0.8125rem;
                        font-weight: 600;
                        color: #44403c;
                        margin-bottom: 0.5rem;
                    }
                    .form-input {
                        width: 100%;
                        padding: 0.75rem 1rem;
                        font-size: 0.9375rem;
                        font-family: inherit;
                        color: #1c1917;
                        background: #fff;
                        border: 1.5px solid #e7e5e4;
                        border-radius: 12px;
                        outline: none;
                        transition: border-color 0.2s, box-shadow 0.2s;
                    }
                    .form-input::placeholder { color: #a8a29e; }
                    .form-input:focus {
                        border-color: var(--primary);
                        box-shadow: 0 0 0 3px var(--primary-light);
                    }
                    .forgot-link {
                        font-size: 0.8125rem;
                        font-weight: 500;
                        color: #78716c;
                        text-decoration: none;
                        transition: color 0.15s;
                    }
                    .forgot-link:hover { color: var(--primary); }
                    .submit-btn {
                        display: flex;
                        width: 100%;
                        align-items: center;
                        justify-content: center;
                        gap: 0.5rem;
                        padding: 0.8125rem 1.5rem;
                        margin-top: 1.75rem;
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
                    .submit-btn:hover { opacity: 0.9; }
                    .submit-btn:active { transform: scale(0.985); }
                    .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
                    .submit-btn svg { transition: transform 0.2s; }
                    .submit-btn:hover svg { transform: translateX(2px); }
                    .error-box {
                        margin-top: 1rem;
                        padding: 0.75rem 1rem;
                        border-radius: 10px;
                        background: #fef2f2;
                        border: 1px solid #fecaca;
                        color: #b91c1c;
                        font-size: 0.875rem;
                        font-weight: 500;
                        text-align: center;
                    }
                    .hidden { display: none; }
                    .divider-row {
                        display: flex;
                        align-items: center;
                        gap: 1rem;
                        margin-top: 2rem;
                    }
                    .divider-line { flex: 1; height: 1px; background: #e7e5e4; }
                    .divider-text {
                        font-size: 0.75rem;
                        color: #a8a29e;
                        text-transform: uppercase;
                        letter-spacing: 0.08em;
                        font-weight: 500;
                    }
                    .alt-link {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 0.375rem;
                        margin-top: 1.25rem;
                        font-size: 0.875rem;
                        color: #57534e;
                        text-decoration: none;
                        font-weight: 500;
                        transition: color 0.15s;
                    }
                    .alt-link:hover { color: var(--primary); }
                    .alt-link svg { width: 16px; height: 16px; }
                    .footer-note {
                        margin-top: 3.5rem;
                        font-size: 0.75rem;
                        color: #a8a29e;
                        text-align: center;
                        line-height: 1.6;
                    }

                    /* ---- Entrance animations ---- */
                    @keyframes enterUp {
                        from { opacity: 0; transform: translateY(16px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                    .enter-up {
                        opacity: 0;
                        animation: enterUp 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards;
                    }
                    .delay-1 { animation-delay: 0.08s; }
                    .delay-2 { animation-delay: 0.16s; }
                    .delay-3 { animation-delay: 0.24s; }
                    .delay-4 { animation-delay: 0.32s; }

                    /* ---- Mobile ---- */
                    @media (max-width: 480px) {
                        .split-left { padding: 1.5rem; }
                        .login-heading { font-size: 1.375rem; }
                        .brand-mark { margin-bottom: 2rem; }
                    }
                ` }} />

                {gaMeasurementId && (
                    <>
                        <script async src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`}></script>
                        <script dangerouslySetInnerHTML={{ __html: `
                            window.dataLayer = window.dataLayer || [];
                            function gtag(){dataLayer.push(arguments);}
                            gtag('js', new Date());
                            gtag('config', '${gaMeasurementId}');
                        ` }} />
                    </>
                )}
            </head>
            <body>
                {/* ======== LEFT: Login Form ======== */}
                <div class="split-left">
                    <div class="login-wrap">
                        <div class="brand-mark enter-up">
                            <div class="brand-icon">
                                <img src={logoUrl || '/logo.svg'} alt={siteName} />
                            </div>
                            <span class="brand-name">{siteName}</span>
                        </div>

                        <h1 class="login-heading enter-up delay-1">Sign in to your workspace</h1>
                        <p class="login-sub enter-up delay-1">Enter your credentials to access inspections, reports, and team tools.</p>

                        <form id="loginForm" autocomplete="on">
                            <div class="form-group enter-up delay-2">
                                <label class="form-label" for="email">Email address</label>
                                <input class="form-input" id="email" name="email" type="email" autocomplete="email" required placeholder="you@company.com" />
                            </div>

                            <div class="form-group enter-up delay-2">
                                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem">
                                    <label class="form-label" for="password" style="margin-bottom:0">Password</label>
                                    <a href="/forgot-password" class="forgot-link">Forgot password?</a>
                                </div>
                                <input class="form-input" id="password" name="password" type="password" autocomplete="current-password" required placeholder="••••••••" />
                            </div>

                            <button class="submit-btn enter-up delay-3" type="submit" id="submitBtn">
                                <span>Sign in</span>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                            </button>
                        </form>

                        <div id="errorMsg" class="error-box hidden"></div>

                        <div class="divider-row enter-up delay-4">
                            <div class="divider-line"></div>
                            <span class="divider-text">or</span>
                            <div class="divider-line"></div>
                        </div>

                        <a href="/book" class="alt-link enter-up delay-4">
                            <span>Book a home inspection</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                        </a>

                        <p class="footer-note enter-up delay-4">
                            Protected workspace &middot; Credentials encrypted in transit
                        </p>
                    </div>
                </div>

                {/* ======== RIGHT: Brand panel ======== */}
                <div class="split-right">
                    <div class="panel-bg"></div>
                    <div class="panel-grid"></div>
                    <div class="panel-accent" style="top: 15%; right: -10%;"></div>
                    <div class="panel-accent" style="bottom: 10%; left: -5%; opacity: 0.2;"></div>

                    <div class="panel-content">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: #a8a29e; margin-bottom: 2rem;">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                            <path d="M8 21h8" />
                            <path d="M12 17v4" />
                            <path d="m7 8 3 3 7-7" />
                        </svg>
                        <h2>Field-ready inspection management</h2>
                        <p>Streamline your workflow from scheduling to final report delivery — built for inspectors who value their time.</p>

                        <div class="stat-row">
                            <div class="stat-item">
                                <div class="stat-value">3min</div>
                                <div class="stat-label">Avg report time</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value">99.9%</div>
                                <div class="stat-label">Uptime</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value">256&#8209;bit</div>
                                <div class="stat-label">Encryption</div>
                            </div>
                        </div>
                    </div>
                </div>

                <script src="/js/login.js"></script>
            </body>
        </html>
    );
};
