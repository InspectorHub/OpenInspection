import type { BrandingConfig } from '../../types/auth';

/**
 * Agent Accounts A3 — Book on Behalf form page (agent surface).
 *
 * Frontend-design directives (non-negotiable per plan):
 *   1. Persistent top mode-bar in soft-orange — "Booking on behalf of client"
 *      with the agent's own name on the right so they never confuse this with
 *      their own booking.
 *   2. After submit, hide the form and render a what-happens-next timeline
 *      ("Submitted -> Client confirms -> Agreement signed -> Inspection scheduled")
 *      so the agent doesn't ping the inspector asking "did this go through?".
 *   3. Form: client name/email/phone + property address + agreement/payment toggles.
 *
 * Sprint 1 design tokens: surface / ink / blueprint, Fraunces serif headlines,
 * DM Sans body. Editorial card-first layout.
 */

export interface ConciergeBookPageProps {
    inspector: {
        name: string | null;
        slug: string | null;
        /** contacts.id of the inspector contact in the active tenant. */
        contactId: string;
    };
    agent: { name: string | null };
    tenantId: string;
    tenantName: string;
    branding?: BrandingConfig | undefined;
}

export const ConciergeBookPage = ({
    inspector,
    agent,
    tenantId,
    tenantName,
    branding,
}: ConciergeBookPageProps): JSX.Element => {
    const siteName = branding?.siteName || 'OpenInspection';
    const inspectorName = inspector.name || inspector.slug || 'this inspector';
    const agentName = agent.name || 'Partner agent';
    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>{`Book for ${inspectorName} | ${siteName}`}</title>
                <script dangerouslySetInnerHTML={{ __html: `(function(){var s=localStorage.getItem('ih-color-scheme');var p=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-color-scheme',s==='dark'||(s===null&&p)?'dark':'light');})()`}} />
                <link rel="stylesheet" href="/fonts.css" />
                <style dangerouslySetInnerHTML={{ __html: `
                    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
                    body {
                        font-family: 'DM Sans', system-ui, sans-serif;
                        background: #fafaf9; color: #1c1917;
                        min-height: 100vh; -webkit-font-smoothing: antialiased;
                    }
                    html[data-color-scheme="dark"] body { background: #0b1120; color: #f1f5f9; }
                    html[data-color-scheme="dark"] h1 .who,
                    html[data-color-scheme="dark"] .lede,
                    html[data-color-scheme="dark"] label,
                    html[data-color-scheme="dark"] .toggle-row { color: #cbd5e1; }
                    html[data-color-scheme="dark"] .form-card,
                    html[data-color-scheme="dark"] .timeline { background: #1e293b; border-color: rgba(255,255,255,0.10); }
                    html[data-color-scheme="dark"] input[type="text"],
                    html[data-color-scheme="dark"] input[type="email"],
                    html[data-color-scheme="dark"] input[type="tel"],
                    html[data-color-scheme="dark"] input[type="date"],
                    html[data-color-scheme="dark"] select { background: #162032; border-color: rgba(255,255,255,0.12); color: #f1f5f9; }
                    html[data-color-scheme="dark"] .toggle-row { background: #162032; border-color: rgba(255,255,255,0.08); }
                    html[data-color-scheme="dark"] .err {
                        background: rgba(127,29,29,0.25);
                        border-color: rgba(248,113,113,0.40);
                        color: #fca5a5;
                    }
                    /* Mode-bar stays warm orange in dark mode — it's a branded
                       persistent context indicator, keep saturation. */
                    html[data-color-scheme="dark"] .mode-bar { background: rgba(154,52,18,0.30); border-color: rgba(254,215,170,0.20); color: #fdba74; }
                    html[data-color-scheme="dark"] .mode-bar .right { color: #fb923c; }
                    /* Mode-bar — persistent, soft-orange. Sticks to top so agent can never
                       lose context of which mode they're in. */
                    .mode-bar {
                        position: sticky; top: 0; z-index: 50;
                        background: #fff4e6;
                        border-bottom: 1px solid #fed7aa;
                        padding: 0.75rem 1.5rem;
                        display: flex; align-items: center; justify-content: space-between;
                        font-size: 0.875rem; font-weight: 600; color: #9a3412;
                    }
                    .mode-bar .left { display: flex; align-items: center; gap: 0.5rem; }
                    .mode-bar .bell { font-size: 1.125rem; }
                    .mode-bar .right { font-size: 0.8125rem; color: #c2410c; }
                    .wrap { max-width: 720px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
                    h1 {
                        font-family: 'Fraunces', Georgia, serif;
                        font-size: 1.75rem; font-weight: 700;
                        line-height: 1.2; margin-bottom: 0.25rem;
                    }
                    h1 .who { color: #57534e; }
                    .lede { color: #57534e; font-size: 0.9375rem; line-height: 1.55; margin-bottom: 1.75rem; }
                    .form-card {
                        background: #fff; border: 1px solid #e7e5e4;
                        border-radius: 14px; padding: 1.75rem 1.5rem;
                        display: grid; gap: 1rem;
                    }
                    label { display: grid; gap: 0.375rem; font-size: 0.8125rem; font-weight: 700; color: #44403c; text-transform: uppercase; letter-spacing: 0.08em; }
                    input[type="text"], input[type="email"], input[type="tel"], input[type="date"], select {
                        font-family: inherit; font-size: 1rem; padding: 0.625rem 0.75rem;
                        border: 1px solid #d6d3d1; border-radius: 8px; background: #fff;
                        color: #1c1917; font-weight: 400;
                    }
                    input:focus, select:focus { outline: 2px solid #F55A1A; outline-offset: 1px; border-color: #F55A1A; }
                    .row-2 { display: grid; gap: 1rem; grid-template-columns: 1fr 1fr; }
                    @media (max-width: 540px) { .row-2 { grid-template-columns: 1fr; } }
                    .toggles { display: grid; gap: 0.625rem; }
                    .toggle-row {
                        display: flex; align-items: center; gap: 0.625rem;
                        padding: 0.625rem 0.75rem; border: 1px solid #e7e5e4; border-radius: 8px;
                        background: #fafaf9; font-size: 0.875rem; color: #44403c;
                        text-transform: none; letter-spacing: 0; font-weight: 500;
                    }
                    .submit-row { margin-top: 0.5rem; }
                    .cta {
                        width: 100%;
                        background: #F55A1A; color: #fff;
                        border: 0; padding: 0.875rem 1.5rem; border-radius: 10px;
                        font-family: 'DM Sans', sans-serif; font-size: 1rem; font-weight: 700;
                        cursor: pointer; transition: filter 0.15s ease;
                    }
                    .cta:hover { filter: brightness(0.95); }
                    .cta:disabled { background: #a8a29e; cursor: progress; }
                    .err {
                        margin-top: 0.75rem; padding: 0.75rem 1rem;
                        background: #fef2f2; color: #b91c1c;
                        border: 1px solid #fecaca; border-radius: 8px;
                        font-size: 0.875rem;
                    }
                    /* Post-submit timeline — appears after a successful submit. */
                    .timeline {
                        background: #fff; border: 1px solid #e7e5e4;
                        border-radius: 14px; padding: 1.75rem 1.5rem;
                        display: grid; gap: 0.875rem;
                    }
                    .step {
                        display: flex; align-items: center; gap: 0.75rem;
                        padding: 0.625rem 0;
                    }
                    .step .dot {
                        width: 24px; height: 24px; border-radius: 50%;
                        background: #e7e5e4; color: #57534e;
                        font-size: 0.75rem; font-weight: 700;
                        display: flex; align-items: center; justify-content: center;
                        flex-shrink: 0;
                    }
                    .step.done .dot { background: #16a34a; color: #fff; }
                    .step.active .dot {
                        background: #F55A1A; color: #fff;
                        animation: pulse 1.6s ease-in-out infinite;
                    }
                    @keyframes pulse {
                        0%, 100% { box-shadow: 0 0 0 0 rgba(245, 90, 26, 0.5); }
                        50% { box-shadow: 0 0 0 8px rgba(245, 90, 26, 0); }
                    }
                    .step .label { font-size: 0.9375rem; font-weight: 600; color: #1c1917; }
                    .step .sub { font-size: 0.8125rem; color: #57534e; margin-top: 0.125rem; }
                    html[data-color-scheme="dark"] .step .dot { background: rgba(255,255,255,0.08); color: #cbd5e1; }
                    html[data-color-scheme="dark"] .step .label { color: #f1f5f9; }
                    html[data-color-scheme="dark"] .step .sub { color: #94a3b8; }
                `}} />
            </head>
            <body>
                <div class="mode-bar" data-testid="mode-bar">
                    <span class="left"><span class="bell" aria-hidden="true">&#128276;</span><span>Booking on behalf of client</span></span>
                    <span class="right">{agentName} &mdash; {tenantName}</span>
                </div>
                <main class="wrap">
                    <h1>Book for <span class="who">{inspectorName}</span></h1>
                    <p class="lede">
                        Fill in your client's details and pick a date. They'll get an email to confirm and review the inspection agreement before anything is finalized.
                    </p>

                    <form id="conciergeBookForm" class="form-card" autocomplete="off">
                        <input type="hidden" name="tenantId" value={tenantId} />
                        <input type="hidden" name="inspectorContactId" value={inspector.contactId} />

                        <div class="row-2">
                            <label>
                                Client name
                                <input type="text" name="clientName" required maxlength={200} placeholder="Sarah Buyer" />
                            </label>
                            <label>
                                Client email
                                <input type="email" name="clientEmail" required maxlength={200} placeholder="sarah@example.com" />
                            </label>
                        </div>
                        <label>
                            Client phone <span style="color:#a8a29e; font-weight:500; text-transform:none;">(optional)</span>
                            <input type="tel" name="clientPhone" maxlength={40} placeholder="(555) 123-4567" />
                        </label>
                        <label>
                            Property address
                            <input type="text" name="propertyAddress" required maxlength={500} placeholder="1 Main St, Springfield" />
                        </label>
                        <div class="row-2">
                            <label>
                                Date
                                <input type="date" name="date" required />
                            </label>
                            <label>
                                Time slot
                                <select name="timeSlot" required>
                                    <option value="">Select a slot</option>
                                    <option value="08:00">8:00 AM</option>
                                    <option value="09:00">9:00 AM</option>
                                    <option value="10:00">10:00 AM</option>
                                    <option value="11:00">11:00 AM</option>
                                    <option value="13:00">1:00 PM</option>
                                    <option value="14:00">2:00 PM</option>
                                    <option value="15:00">3:00 PM</option>
                                </select>
                            </label>
                        </div>
                        <div class="toggles">
                            <label class="toggle-row">
                                <input type="checkbox" name="agreementRequired" checked /> Inspector requires the client to e-sign an inspection agreement
                            </label>
                            <label class="toggle-row">
                                <input type="checkbox" name="paymentRequired" /> Inspector requires payment before the inspection
                            </label>
                        </div>
                        <div class="submit-row">
                            <button type="submit" class="cta">Send booking to client</button>
                            <div id="conciergeErr" class="err" style="display:none;"></div>
                        </div>
                    </form>

                    <section
                        id="conciergeTimeline"
                        class="timeline"
                        data-testid="post-submit-timeline"
                        style="display:none; margin-top: 1.25rem;"
                    >
                        <div class="step done"><span class="dot">&#10003;</span><div><div class="label">Submitted</div><div class="sub">Booking sent.</div></div></div>
                        <div class="step active"><span class="dot">2</span><div><div class="label">Client confirms</div><div class="sub" id="confirmSub">Magic link sent &mdash; waiting on the client.</div></div></div>
                        <div class="step"><span class="dot">3</span><div><div class="label">Agreement signed</div><div class="sub">Client reads and e-signs the inspection agreement.</div></div></div>
                        <div class="step"><span class="dot">4</span><div><div class="label">Inspection scheduled</div><div class="sub">You'll see it on your dashboard once locked in.</div></div></div>
                    </section>
                </main>
                <script src="/js/concierge-book.js"></script>
            </body>
        </html>
    );
};
