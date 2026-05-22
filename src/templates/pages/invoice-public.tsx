import type { FC } from 'hono/jsx';

interface InvoicePublicProps {
    companyName:        string;
    primaryColor:       string;
    propertyAddress?:   string | null;
    inspectorName?:     string | null;
    inspectorEmail?:    string | null;
    scheduledDate?:     string | null;
    invoice: {
        id:           string;
        amountCents:  number;
        status:       'draft' | 'sent' | 'paid' | 'partial';
        dueDate?:     string | null;
        notes?:       string | null;
        lineItems:    Array<{ description: string; amountCents: number }>;
    } | null;
    /**
     * When the inspector workspace has Stripe Connect configured, we surface
     * a "Pay now" CTA that hands off to a hosted Checkout session. When
     * absent, we fall back to a "Contact your inspector" message — never a
     * dead-end for the customer.
     */
    payUrl?: string | null;
}

/**
 * iter-2 production bug #10 — public invoice payment page.
 *
 * Token-gated companion to `/r/:id/repair-request` (Sprint 3 S3-2). The
 * customer landing here came from the report-gate "Pay invoice" CTA and
 * has no account, so this page MUST work without authentication.
 *
 * Design mirrors `report-gate.tsx`: calm amber pill, single CTA, branded
 * footer. Self-contained inline styles so the page renders even when
 * /styles.css is unavailable.
 */
export const InvoicePublicPage: FC<InvoicePublicProps> = ({
    companyName, primaryColor,
    propertyAddress, inspectorName, inspectorEmail, scheduledDate,
    invoice, payUrl,
}) => {
    const formattedDate = scheduledDate ? (() => {
        try {
            return new Date(scheduledDate).toLocaleDateString('en-US', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            });
        } catch {
            return scheduledDate;
        }
    })() : null;

    const formatMoney = (cents: number) => {
        const dollars = (cents / 100).toFixed(2);
        return `$${dollars}`;
    };

    const isPaid = invoice?.status === 'paid';
    const hasInvoice = !!invoice;
    const canPayOnline = hasInvoice && !isPaid && !!payUrl;

    const title = isPaid ? 'Invoice paid' : (hasInvoice ? 'Invoice due' : 'Payment information');
    const headline = isPaid
        ? 'Your invoice has been paid.'
        : (hasInvoice
            ? 'Complete your payment to view the report.'
            : 'Contact your inspector for payment instructions.');

    const message = isPaid
        ? 'Thank you. Your inspection report should be available now — if you still see the gate, please refresh the page.'
        : (hasInvoice
            ? (canPayOnline
                ? 'Review the line items below and pay securely with your card. Once payment is confirmed, your inspection report will unlock automatically.'
                : 'Your inspector will reach out with payment instructions, or you can contact them using the details below.')
            : 'No invoice has been issued for this inspection yet. Please contact your inspector to arrange payment.');

    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>{title} — {companyName}</title>
                {/* Customer-portal page — follow system color preference only;
                    no localStorage / no in-page toggle (per design system). */}
                <script dangerouslySetInnerHTML={{ __html: `(function(){var p=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-color-scheme',p?'dark':'light');})()`}} />
                <style dangerouslySetInnerHTML={{ __html: `
                    /* Use the customer-portal warm palette tokens (defined
                       in input.css) — they auto-swap to warm-dark under
                       [data-color-scheme="dark"], so no duplicate dark
                       rule block is needed here. */
                    :root { --brand: ${primaryColor}; }
                    * { box-sizing: border-box; }
                    body {
                        margin: 0;
                        background: var(--cp-bg);
                        color: var(--cp-fg-1);
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
                        background: var(--cp-bg-card);
                        border: var(--cp-border);
                        border-radius: 12px;
                        padding: 32px;
                        max-width: 520px;
                        width: 100%;
                    }
                    /* Status pills use the global --ih-status-* tokens, which
                       also re-resolve to legible dark equivalents. */
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
                        margin-bottom: 16px;
                    }
                    .pill.amber { background: var(--ih-status-watch-bg); color: var(--ih-status-watch-fg); }
                    .pill.green { background: var(--ih-status-ok-bg);    color: var(--ih-status-ok-fg); }
                    .pill::before {
                        content: '';
                        display: inline-block;
                        width: 6px; height: 6px;
                        border-radius: 50%;
                    }
                    .pill.amber::before { background: var(--ih-status-watch); }
                    .pill.green::before { background: var(--ih-status-ok); }
                    h1 {
                        margin: 0 0 8px 0;
                        font-size: 22px;
                        font-weight: 700;
                        letter-spacing: -0.015em;
                        color: var(--cp-fg-1);
                    }
                    p.lead {
                        margin: 0 0 24px 0;
                        color: var(--cp-fg-3);
                        line-height: 1.6;
                    }
                    .meta {
                        background: var(--cp-bg-muted);
                        border: var(--cp-border);
                        border-radius: 6px;
                        padding: 12px 16px;
                        margin: 0 0 24px 0;
                        font-size: 13px;
                        color: var(--cp-fg-2);
                    }
                    .meta strong { color: var(--cp-fg-1); font-weight: 600; }
                    .meta div + div { margin-top: 4px; }
                    .invoice-box {
                        border: var(--cp-border);
                        border-radius: 8px;
                        padding: 16px;
                        margin: 0 0 24px 0;
                    }
                    .invoice-box .row {
                        display: flex;
                        justify-content: space-between;
                        align-items: baseline;
                        padding: 6px 0;
                        font-size: 13px;
                        color: var(--cp-fg-2);
                    }
                    .invoice-box .row + .row { border-top: 1px solid var(--cp-divider); }
                    .invoice-box .row.total {
                        border-top: var(--cp-border-strong);
                        margin-top: 4px;
                        padding-top: 12px;
                        color: var(--cp-fg-1);
                        font-weight: 700;
                        font-size: 15px;
                    }
                    .invoice-box .row.total .amount { color: var(--brand); }
                    .invoice-box .desc { color: var(--cp-fg-2); }
                    .invoice-box .amount { color: var(--cp-fg-1); font-variant-numeric: tabular-nums; font-weight: 600; }
                    .due-line {
                        font-size: 12px;
                        color: var(--cp-fg-3);
                        margin-top: 8px;
                    }
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
                        box-shadow: var(--ih-shadow-focus);
                    }
                    .contact-line {
                        font-size: 13px;
                        color: var(--cp-fg-2);
                        margin-top: 4px;
                    }
                    .contact-line a { color: var(--brand); text-decoration: none; }
                    .contact-line a:hover { text-decoration: underline; }
                    .brand {
                        margin-top: 24px;
                        font-size: 11px;
                        color: var(--cp-fg-4);
                        text-align: center;
                    }
                    @media (prefers-reduced-motion: reduce) {
                        a.cta { transition: none; }
                    }
                `}} />
            </head>
            <body>
                <div class="card">
                    <span class={isPaid ? 'pill green' : 'pill amber'}>{title}</span>
                    <h1>{headline}</h1>
                    <p class="lead">{message}</p>

                    {(propertyAddress || inspectorName || formattedDate) && (
                        <div class="meta">
                            {propertyAddress && <div><strong>{propertyAddress}</strong></div>}
                            {inspectorName && <div>Inspector: {inspectorName}</div>}
                            {formattedDate && <div>Scheduled: {formattedDate}</div>}
                        </div>
                    )}

                    {invoice && (
                        <div class="invoice-box">
                            {invoice.lineItems.length > 0 ? (
                                invoice.lineItems.map((line) => (
                                    <div class="row">
                                        <span class="desc">{line.description}</span>
                                        <span class="amount">{formatMoney(line.amountCents)}</span>
                                    </div>
                                ))
                            ) : (
                                <div class="row">
                                    <span class="desc">Inspection services</span>
                                    <span class="amount">{formatMoney(invoice.amountCents)}</span>
                                </div>
                            )}
                            <div class="row total">
                                <span>Total {isPaid ? 'paid' : 'due'}</span>
                                <span class="amount">{formatMoney(invoice.amountCents)}</span>
                            </div>
                            {invoice.dueDate && !isPaid && (
                                <div class="due-line">Due by {invoice.dueDate}</div>
                            )}
                        </div>
                    )}

                    {canPayOnline && payUrl && (
                        <a class="cta" href={payUrl}>Pay {formatMoney(invoice!.amountCents)} now</a>
                    )}
                    {!canPayOnline && !isPaid && (inspectorName || inspectorEmail) && (
                        <div class="contact-line">
                            Contact{' '}
                            {inspectorEmail
                                ? <a href={`mailto:${inspectorEmail}`}>{inspectorName || inspectorEmail}</a>
                                : <strong>{inspectorName}</strong>}
                            {' '}to arrange payment.
                        </div>
                    )}

                    <div class="brand">Powered by {companyName}</div>
                </div>
            </body>
        </html>
    );
};
