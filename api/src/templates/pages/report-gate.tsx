import type { FC } from 'hono/jsx';

interface ReportGateProps {
    reason:           'payment' | 'agreement';
    companyName:      string;
    primaryColor:     string;
    actionUrl:        string;
    actionLabel:      string;
    propertyAddress?: string | null;
    inspectorName?:   string | null;
    inspectorEmail?:  string | null;
    inspectorPhone?:  string | null;
    inspectorLicense?:string | null;
    scheduledDate?:   string | null;
    amountCents?:     number | null;
    currency?:        string | null;
}

/**
 * Sprint 1 Sub-spec C-7 — calm, branded report-gate page.
 *
 * Tone: amber "action needed" pill, not red alarm. Body explains in plain
 * English what is pending and a single primary CTA to resolve it.
 *
 * Iter-3 design polish:
 *   * The CTA carries the dollar amount when this is a payment gate, so the
 *     customer sees what they're agreeing to before they click.
 *   * Inspector contact rows (phone / email / license) honor the body
 *     promise that "your inspector's contact details are listed below"
 *     instead of shipping a broken promise.
 *   * Display font (Fraunces) lifts the H1 out of generic dashboard
 *     territory; body remains in a refined system stack.
 *   * Footer drops "Powered by …" in favor of a Stripe trust badge so the
 *     payment context is reinforced instead of advertising us.
 *   * Pill pulses subtly so the gate signals "we're waiting on you."
 *   * CTA goes full-width below 480px to enlarge the tap target.
 *
 * Self-contained HTML (does not extend BareLayout) so the gate keeps
 * working when /styles.css is unavailable — for example when the worker
 * is configured without the public assets binding. All visuals come from
 * inline `<style>` so the page renders correctly in any context.
 */
export const ReportGatePage: FC<ReportGateProps> = ({
    reason, companyName, primaryColor, actionUrl, actionLabel,
    propertyAddress, inspectorName, inspectorEmail, inspectorPhone, inspectorLicense,
    scheduledDate, amountCents, currency,
}) => {
    const title = reason === 'payment'
        ? 'Pending payment'
        : 'Pending agreement signature';
    const message = reason === 'payment'
        ? "Your inspection report is ready, but the invoice has not been paid yet. Please complete payment to view the report — your inspector's contact details are listed below."
        : 'Your inspection report is ready, but the inspection agreement has not been signed yet. Please sign the agreement to view the report.';

    const formattedDate = scheduledDate ? (() => {
        try {
            return new Date(scheduledDate).toLocaleDateString('en-US', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            });
        } catch {
            return scheduledDate;
        }
    })() : null;

    const formattedAmount = (typeof amountCents === 'number' && amountCents > 0)
        ? new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency || 'USD',
            minimumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
        }).format(amountCents / 100)
        : null;

    const ctaLabel = (reason === 'payment' && formattedAmount)
        ? `Pay ${formattedAmount} now`
        : actionLabel;

    const hasContact = !!(inspectorEmail || inspectorPhone || inspectorLicense);

    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>{title} — {companyName}</title>
                <link
                    rel="preconnect"
                    href="https://fonts.googleapis.com"
                />
                <link
                    rel="preconnect"
                    href="https://fonts.gstatic.com"
                    crossorigin="anonymous"
                />
                <link
                    rel="stylesheet"
                    href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap"
                />
                <style dangerouslySetInnerHTML={{ __html: `
                    :root { --brand: ${primaryColor}; }
                    * { box-sizing: border-box; }
                    body {
                        margin: 0;
                        background: #f8fafc;
                        color: #0f172a;
                        font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', Arial, sans-serif;
                        font-size: 14px;
                        line-height: 1.5;
                        min-height: 100vh;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        padding: 24px 16px;
                    }
                    .card {
                        background: #ffffff;
                        border: 1px solid #e2e8f0;
                        border-radius: 14px;
                        padding: 32px;
                        max-width: 480px;
                        width: 100%;
                        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px rgba(15, 23, 42, 0.04);
                    }
                    .pill {
                        display: inline-flex;
                        align-items: center;
                        gap: 6px;
                        height: 24px;
                        padding: 0 8px;
                        border-radius: 4px;
                        font-size: 11px;
                        font-weight: 600;
                        letter-spacing: 0.02em;
                        background: #fef3c7;
                        color: #92400e;
                        margin-bottom: 16px;
                    }
                    .pill::before {
                        content: '';
                        display: inline-block;
                        width: 6px; height: 6px;
                        border-radius: 50%;
                        background: #f59e0b;
                        animation: pulse 2s ease-in-out infinite;
                    }
                    @keyframes pulse {
                        0%, 100% { opacity: 1; transform: scale(1); }
                        50%      { opacity: 0.55; transform: scale(0.85); }
                    }
                    h1 {
                        margin: 0 0 8px 0;
                        font-family: 'Fraunces', Georgia, 'Times New Roman', serif;
                        font-size: 26px;
                        font-weight: 600;
                        letter-spacing: -0.018em;
                        color: #0f172a;
                        line-height: 1.2;
                    }
                    p.lead {
                        margin: 0 0 24px 0;
                        color: #64748b;
                        line-height: 1.6;
                    }
                    .meta {
                        background: #f8fafc;
                        border: 1px solid #e2e8f0;
                        border-radius: 8px;
                        padding: 16px;
                        margin: 0 0 24px 0;
                        font-size: 13px;
                        color: #475569;
                    }
                    .meta strong { color: #0f172a; font-weight: 600; }
                    .meta-row { display: flex; gap: 8px; align-items: baseline; }
                    .meta-row + .meta-row { margin-top: 6px; }
                    .meta-label {
                        flex: 0 0 80px;
                        font-size: 11px;
                        text-transform: uppercase;
                        letter-spacing: 0.06em;
                        color: #94a3b8;
                    }
                    .meta-value { color: #0f172a; }
                    .meta-value a { color: var(--brand); text-decoration: none; }
                    .meta-value a:hover { text-decoration: underline; }
                    .meta-divider {
                        height: 1px;
                        background: #e2e8f0;
                        margin: 12px 0;
                    }
                    .amount-row {
                        display: flex;
                        justify-content: space-between;
                        align-items: baseline;
                        padding-bottom: 12px;
                        margin-bottom: 12px;
                        border-bottom: 1px solid #e2e8f0;
                    }
                    .amount-label {
                        font-size: 11px;
                        text-transform: uppercase;
                        letter-spacing: 0.06em;
                        color: #94a3b8;
                    }
                    .amount-value {
                        font-family: 'Fraunces', Georgia, serif;
                        font-size: 22px;
                        font-weight: 600;
                        color: #0f172a;
                        letter-spacing: -0.015em;
                    }
                    a.cta {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        height: 44px;
                        padding: 0 24px;
                        border-radius: 8px;
                        background: var(--brand);
                        color: #ffffff;
                        font-weight: 700;
                        font-size: 14px;
                        text-decoration: none;
                        transition: opacity 120ms ease, transform 120ms ease, box-shadow 120ms ease;
                        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
                    }
                    a.cta:hover {
                        opacity: 0.95;
                        transform: translateY(-1px);
                        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.12);
                    }
                    a.cta:focus-visible {
                        outline: none;
                        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.32);
                    }
                    .trust {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 6px;
                        margin-top: 20px;
                        font-size: 11px;
                        color: #94a3b8;
                    }
                    .trust svg {
                        width: 11px;
                        height: 11px;
                    }
                    @media (max-width: 480px) {
                        .card { padding: 24px; }
                        h1 { font-size: 22px; }
                        a.cta { width: 100%; }
                        .meta-label { flex-basis: 70px; }
                    }
                    @media (prefers-reduced-motion: reduce) {
                        a.cta { transition: none; }
                        a.cta:hover { transform: none; }
                        .pill::before { animation: none; }
                    }
                `}} />
            </head>
            <body>
                <div class="card">
                    <span class="pill">{title}</span>
                    <h1>Your report is almost ready.</h1>
                    <p class="lead">{message}</p>

                    {(formattedAmount || propertyAddress || inspectorName || formattedDate || hasContact) && (
                        <div class="meta">
                            {formattedAmount && (
                                <div class="amount-row">
                                    <span class="amount-label">Amount due</span>
                                    <span class="amount-value">{formattedAmount}</span>
                                </div>
                            )}
                            {propertyAddress && (
                                <div class="meta-row">
                                    <span class="meta-label">Property</span>
                                    <span class="meta-value"><strong>{propertyAddress}</strong></span>
                                </div>
                            )}
                            {formattedDate && (
                                <div class="meta-row">
                                    <span class="meta-label">Scheduled</span>
                                    <span class="meta-value">{formattedDate}</span>
                                </div>
                            )}
                            {inspectorName && (
                                <div class="meta-row">
                                    <span class="meta-label">Inspector</span>
                                    <span class="meta-value">{inspectorName}</span>
                                </div>
                            )}
                            {hasContact && (propertyAddress || inspectorName || formattedDate) && (
                                <div class="meta-divider" />
                            )}
                            {inspectorEmail && (
                                <div class="meta-row">
                                    <span class="meta-label">Email</span>
                                    <span class="meta-value"><a href={`mailto:${inspectorEmail}`}>{inspectorEmail}</a></span>
                                </div>
                            )}
                            {inspectorPhone && (
                                <div class="meta-row">
                                    <span class="meta-label">Phone</span>
                                    <span class="meta-value"><a href={`tel:${inspectorPhone}`}>{inspectorPhone}</a></span>
                                </div>
                            )}
                            {inspectorLicense && (
                                <div class="meta-row">
                                    <span class="meta-label">License</span>
                                    <span class="meta-value">{inspectorLicense}</span>
                                </div>
                            )}
                        </div>
                    )}

                    <a class="cta" href={actionUrl}>{ctaLabel}</a>

                    {reason === 'payment' ? (
                        <div class="trust" aria-label="Payments are secured by Stripe">
                            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                                <rect x="3" y="7" width="10" height="6" rx="1" />
                                <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
                            </svg>
                            Secured by Stripe · {companyName}
                        </div>
                    ) : (
                        <div class="trust">{companyName}</div>
                    )}
                </div>
            </body>
        </html>
    );
};
