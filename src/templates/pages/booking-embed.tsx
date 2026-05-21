import { raw } from 'hono/html';

interface Props {
    slug: string;
    inspectorId: string;
    inspectorName: string;
    tenantSubdomain: string;
    siteKey: string;
    style?: 'full' | 'compact';
}

const EMBED_STYLES = `
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; color: #0f172a; background: transparent; }
.embed-root { padding: 16px; }
.embed-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; }
.embed-title { font-size: 16px; font-weight: 700; margin: 0 0 4px; }
.embed-subtitle { font-size: 13px; color: #64748b; margin: 0 0 16px; }
.embed-field { display: block; margin-bottom: 12px; }
.embed-field label { display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin-bottom: 4px; }
.embed-field input,
.embed-field textarea { display: block; width: 100%; padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 14px; font-family: inherit; }
.embed-field input:focus,
.embed-field textarea:focus { outline: none; border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2); }
.embed-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.embed-cta { display: block; width: 100%; padding: 12px 16px; background: #6366f1; color: #fff; border: none; border-radius: 8px; font-weight: 700; font-size: 14px; cursor: pointer; transition: opacity 150ms; }
.embed-cta:hover { opacity: 0.92; }
.embed-cta:disabled { opacity: 0.5; cursor: not-allowed; }
.embed-status { margin-top: 12px; font-size: 13px; min-height: 1em; }
.embed-status--ok { color: #15803d; }
.embed-status--error { color: #b91c1c; }
.embed-compact { padding: 24px 20px; text-align: center; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; }
.embed-compact-name { font-size: 13px; color: #64748b; margin: 0 0 12px; }
@media (max-width: 480px) {
    .embed-grid { grid-template-columns: 1fr; }
}
/* Follow the embedding site's color scheme — host page sets it via
   prefers-color-scheme; we keep body bg transparent so the host bg
   bleeds through, then adjust just the card chrome. */
@media (prefers-color-scheme: dark) {
    body { color: #f1f5f9; }
    .embed-card,
    .embed-compact { background: #1e293b; border-color: rgba(255,255,255,0.10); }
    .embed-subtitle,
    .embed-compact-name { color: #94a3b8; }
    .embed-field label { color: #94a3b8; }
    .embed-field input,
    .embed-field textarea { background: #162032; border-color: rgba(255,255,255,0.12); color: #f1f5f9; }
    .embed-status--ok { color: #4ade80; }
    .embed-status--error { color: #fca5a5; }
}
`;

/**
 * Booking #7 Sprint C-4 — iframe-friendly booking form.
 *
 * Strict no-chrome contract: zero nav, zero sidebar, zero "OpenInspection"
 * lockup. The form streams to /api/public/book and emits two postMessage
 * channels via /js/embed-resize.js + /js/booking-embed-success.js so the
 * host page can autosize the iframe and react to bookings.
 *
 * Two style variants:
 *   - full     (default): full booking form rendered inline.
 *   - compact          : single CTA button that opens the host's chosen
 *                        action (host listens for the `oi-embed:click` event
 *                        and decides whether to expand the iframe or pop a
 *                        new window).
 */
export const BookingEmbedPage = ({
    slug, inspectorId, inspectorName, tenantSubdomain, siteKey, style,
}: Props): JSX.Element => {
    const variant: 'full' | 'compact' = style === 'compact' ? 'compact' : 'full';
    const turnstileEnabled = !!siteKey;

    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>Book inspection</title>
                <link rel="stylesheet" href="/fonts.css" />
                {raw(`<style>${EMBED_STYLES}</style>`)}
            </head>
            <body data-embed-style={variant} data-tenant-subdomain={tenantSubdomain}>
                <div class="embed-root">
                    {variant === 'compact' ? (
                        <div class="embed-compact">
                            <p class="embed-compact-name">Book with {inspectorName}</p>
                            <button
                                type="button"
                                data-testid="embed-compact-cta"
                                class="embed-cta"
                                onclick={`(function(){window.parent.postMessage({type:'oi-embed',kind:'click',slug:'${slug}'},'*');var f=document.getElementById('compactForm');if(f){f.style.display='block';this.style.display='none';}})()`}
                            >
                                Schedule an inspection
                            </button>
                            <div id="compactForm" style="display:none;margin-top:16px;text-align:left;">
                                <BookingFormFragment
                                    slug={slug}
                                    inspectorId={inspectorId}
                                    inspectorName={inspectorName}
                                    siteKey={siteKey}
                                    turnstileEnabled={turnstileEnabled}
                                />
                            </div>
                        </div>
                    ) : (
                        <div class="embed-card">
                            <h2 class="embed-title">Book with {inspectorName}</h2>
                            <p class="embed-subtitle">Pick a date and we'll confirm by email.</p>
                            <BookingFormFragment
                                slug={slug}
                                inspectorId={inspectorId}
                                inspectorName={inspectorName}
                                siteKey={siteKey}
                                turnstileEnabled={turnstileEnabled}
                            />
                        </div>
                    )}
                </div>

                {turnstileEnabled && (
                    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
                )}
                <script src="/js/embed-resize.js"></script>
                <script src="/js/booking-embed-success.js"></script>
                <script src="/js/booking-embed-form.js"></script>
            </body>
        </html>
    );
};

interface FragmentProps {
    slug: string;
    inspectorId: string;
    inspectorName: string;
    siteKey: string;
    turnstileEnabled: boolean;
}

const BookingFormFragment = ({ slug, inspectorId, siteKey, turnstileEnabled }: FragmentProps): JSX.Element => (
    <form id="embedBookingForm" data-slug={slug} data-inspector-id={inspectorId}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="inspectorId" value={inspectorId} />
        <div class="embed-field">
            <label for="embedAddress">Property address</label>
            <input type="text" id="embedAddress" name="address" required placeholder="123 Main St, Austin, TX" />
        </div>
        <div class="embed-grid">
            <div class="embed-field">
                <label for="embedClientName">Your name</label>
                <input type="text" id="embedClientName" name="clientName" required placeholder="Jane Doe" />
            </div>
            <div class="embed-field">
                <label for="embedClientEmail">Email</label>
                <input type="email" id="embedClientEmail" name="clientEmail" required placeholder="jane@example.com" />
            </div>
        </div>
        <div class="embed-grid">
            <div class="embed-field">
                <label for="embedClientPhone">Phone</label>
                <input type="tel" id="embedClientPhone" name="clientPhone" placeholder="(555) 555-5555" />
            </div>
            <div class="embed-field">
                <label for="embedDate">Preferred date</label>
                <input type="date" id="embedDate" name="date" required />
            </div>
        </div>
        {turnstileEnabled && (
            <div class="cf-turnstile" data-sitekey={siteKey} data-size="flexible"></div>
        )}
        <button type="submit" class="embed-cta">Request booking</button>
        <div id="embedStatus" class="embed-status" data-testid="embed-status"></div>
    </form>
);
