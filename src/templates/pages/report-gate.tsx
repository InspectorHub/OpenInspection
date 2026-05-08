import type { FC } from 'hono/jsx';

interface ReportGateProps {
    reason:           'payment' | 'agreement';
    companyName:      string;
    primaryColor:     string;
    actionUrl:        string;
    actionLabel:      string;
    propertyAddress?: string | null;   // Spec 3A — inspection summary card
    inspectorName?:   string | null;   // Spec 3A — TODO: requires join to users table
    scheduledDate?:   string | null;   // Spec 3A — ISO date string
}

/**
 * Sprint 1 Sub-spec C-7 — calm, branded report-gate page.
 *
 * Tone: amber "action needed" pill, not red alarm. Body explains in plain
 * English what is pending and a single primary CTA to resolve it. NO
 * atmospheric blob, NO emoji icon, NO color-tinted shadow — per design
 * system reference (`docs/superpowers/plans/2026-05-08-sprint1-design-
 * system-reference.md`).
 *
 * Self-contained HTML (does not extend BareLayout) so the gate keeps
 * working when /styles.css is unavailable — for example when the worker
 * is configured without the public assets binding. All visuals come from
 * inline `<style>` so the page renders correctly in any context.
 */
export const ReportGatePage: FC<ReportGateProps> = ({
    reason, companyName, primaryColor, actionUrl, actionLabel,
    propertyAddress, inspectorName, scheduledDate,
}) => {
    const titleMap = {
        payment:   'Pending payment',
        agreement: 'Pending agreement signature',
    };
    const messageMap = {
        payment:   "Your inspection report is ready, but the invoice has not been paid yet. Please complete payment to view the report — your inspector's contact details are listed below.",
        agreement: "Your inspection report is ready, but the inspection agreement has not been signed yet. Please sign the agreement to view the report.",
    };
    const title = titleMap[reason];
    const message = messageMap[reason];

    const formattedDate = scheduledDate ? (() => {
        try {
            return new Date(scheduledDate).toLocaleDateString('en-US', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            });
        } catch {
            return scheduledDate;
        }
    })() : null;

    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>{title} — {companyName}</title>
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
                        border-radius: 12px;
                        padding: 32px;
                        max-width: 480px;
                        width: 100%;
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
                    }
                    h1 {
                        margin: 0 0 8px 0;
                        font-size: 22px;
                        font-weight: 700;
                        letter-spacing: -0.015em;
                        color: #0f172a;
                    }
                    p.lead {
                        margin: 0 0 24px 0;
                        color: #64748b;
                        line-height: 1.6;
                    }
                    .meta {
                        background: #f8fafc;
                        border: 1px solid #e2e8f0;
                        border-radius: 6px;
                        padding: 12px 16px;
                        margin: 0 0 24px 0;
                        font-size: 13px;
                        color: #475569;
                    }
                    .meta strong { color: #0f172a; font-weight: 600; }
                    .meta div + div { margin-top: 4px; }
                    a.cta {
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        height: 40px;
                        padding: 0 20px;
                        border-radius: 6px;
                        background: var(--brand);
                        color: #ffffff;
                        font-weight: 700;
                        font-size: 13px;
                        text-decoration: none;
                        transition: opacity 120ms ease;
                    }
                    a.cta:hover { opacity: 0.92; }
                    a.cta:focus-visible {
                        outline: none;
                        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.32);
                    }
                    .brand {
                        margin-top: 24px;
                        font-size: 11px;
                        color: #94a3b8;
                        text-align: center;
                    }
                    @media (prefers-reduced-motion: reduce) {
                        a.cta { transition: none; }
                    }
                `}} />
            </head>
            <body>
                <div class="card">
                    <span class="pill">{title}</span>
                    <h1>Your report is almost ready.</h1>
                    <p class="lead">{message}</p>

                    {(propertyAddress || inspectorName || formattedDate) && (
                        <div class="meta">
                            {propertyAddress && <div><strong>{propertyAddress}</strong></div>}
                            {inspectorName && <div>Inspector: {inspectorName}</div>}
                            {formattedDate && <div>Scheduled: {formattedDate}</div>}
                        </div>
                    )}

                    <a class="cta" href={actionUrl}>{actionLabel}</a>
                    <div class="brand">Powered by {companyName}</div>
                </div>
            </body>
        </html>
    );
};
