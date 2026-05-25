import { raw } from 'hono/html';
import type { InspectorProfile } from '../../services/user.service';

/**
 * Booking #7 Sprint C-1 — public editorial profile page.
 *
 * Frontend-design directives (non-negotiable, per plan top):
 *   1. Asymmetric editorial hero — oversized Fraunces name, photo bleeds
 *      off-grid. NOT a centered card.
 *   2. Services rendered as a 3-up card grid (monospace duration + display
 *      price + body-type service name). Never a table.
 *   3. Trust strip above the CTA — "Insured · Licensed · N service areas".
 *   4. Mobile (<= 600px): hero photo collapses 256 -> 120px, services stack.
 *   5. Email is rendered as base64 in a data-* attribute and revealed by a
 *      tiny inline click handler so naïve scrapers can't harvest it.
 */
export interface CatalogService {
    name: string;
    durationMinutes: number | null;
    price: number; // cents
}

interface Props {
    profile: InspectorProfile;
    services: CatalogService[];
    host: string;
    tenantSlug: string;
}

const fmtPrice = (cents: number): string => '$' + Math.round(cents / 100).toLocaleString();
const fmtDuration = (min: number | null): string => {
    if (min == null || min <= 0) return '';
    if (min >= 60) {
        const h = Math.floor(min / 60);
        const m = min % 60;
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    return `${min}m`;
};

// Workers runtime exposes btoa globally; fall back to Buffer for Node test envs.
const toBase64 = (s: string): string => {
    if (typeof btoa === 'function') return btoa(s);
    return Buffer.from(s, 'utf8').toString('base64');
};

const HERO_STYLES = `
/* Customer-portal page — uses the warm --cp-* / --ih-* tokens defined in
   input.css (auto-swap to dark via [data-color-scheme="dark"]). No
   duplicate dark CSS block is needed here. */
body { background: var(--cp-bg); font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; color: var(--cp-fg-1); margin: 0; }
.hero { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; align-items: end; padding: 96px 64px 48px; max-width: 1200px; margin: 0 auto; }
.hero-name { font-family: 'Fraunces', Georgia, serif; font-size: 96px; font-weight: 600; letter-spacing: -0.02em; line-height: 0.95; margin: 0; transform: translateX(-12px); color: var(--cp-fg-1); }
.hero-photo-wrap { display: flex; justify-content: flex-end; }
.hero-photo { width: 100%; max-width: 360px; aspect-ratio: 1; border-radius: 50%; object-fit: cover; transform: translateY(48px); display: block; }
.hero-photo--placeholder { display: flex; align-items: center; justify-content: center; background: var(--cp-bg-muted); color: var(--cp-fg-4); font-family: 'Fraunces', serif; font-size: 96px; font-weight: 600; }
.meta-strip { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; letter-spacing: 0.08em; color: var(--cp-fg-3); margin-top: 16px; text-transform: uppercase; }
.area-chip { display: inline-block; padding: 4px 10px; border-radius: 100px; background: var(--cp-bg-muted); color: var(--cp-fg-2); font-size: 12px; margin: 0 6px 6px 0; }
.bio { max-width: 640px; padding: 24px 64px; font-size: 18px; line-height: 1.6; color: var(--cp-fg-2); margin: 0 auto; }
.services-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; max-width: 1200px; margin: 48px auto; padding: 0 64px; }
.service-card { background: var(--cp-bg-card); border: var(--cp-border); border-radius: 12px; padding: 24px; }
.service-duration { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--cp-fg-4); letter-spacing: 0.06em; text-transform: uppercase; }
.service-price { font-family: 'Fraunces', serif; font-size: 32px; font-weight: 600; margin: 8px 0; line-height: 1; }
.service-name { font-size: 14px; color: var(--cp-fg-2); }
.trust-strip { background: var(--cp-hero-bg); color: var(--cp-hero-fg); padding: 24px 64px; margin: 48px 0 0; display: flex; justify-content: center; gap: 48px; font-size: 13px; letter-spacing: 0.04em; flex-wrap: wrap; }
.cta-section { padding: 64px; text-align: center; }
.cta-button { display: inline-block; background: var(--ih-primary, #6366f1); color: #fff; padding: 16px 32px; border-radius: 8px; font-weight: 700; text-decoration: none; font-size: 16px; transition: opacity 150ms; }
.cta-button:hover { opacity: 0.9; }
.contact-footer { padding: 32px 64px; font-size: 13px; color: var(--cp-fg-3); text-align: center; border-top: var(--cp-border); }
.contact-link { background: none; border: none; color: inherit; cursor: pointer; text-decoration: underline; font: inherit; padding: 0; }
@media (max-width: 600px) {
    .hero { grid-template-columns: 1fr; padding: 48px 24px 24px; gap: 16px; }
    .hero-name { font-size: 56px; transform: none; }
    .hero-photo-wrap { justify-content: flex-start; }
    .hero-photo { max-width: 120px; transform: none; }
    .hero-photo--placeholder { font-size: 56px; }
    .bio { padding: 16px 24px; font-size: 16px; }
    .services-grid { grid-template-columns: 1fr; padding: 0 24px; gap: 12px; margin: 24px auto; }
    .trust-strip { flex-direction: column; gap: 12px; padding: 24px; text-align: center; }
    .cta-section { padding: 32px 24px; }
    .cta-button { display: block; width: 100%; box-sizing: border-box; }
    .contact-footer { padding: 24px; }
}
`;

export const InspectorProfilePage = ({ profile, services, host, tenantSlug }: Props): JSX.Element => {
    const { name, bio, photoUrl, licenseNumber, email, phone, slug, serviceAreas } = profile;
    // Defensive fallback only — setup wizard requires a name for new accounts.
    // Legacy accounts without one fall back to a polite literal, never email.
    const displayName = name ?? 'Inspector';
    const cityList = serviceAreas.slice(0, 2).map(a => a.city).join(', ');
    const initials = displayName.split(/\s+/).map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
    const emailB64 = email ? toBase64(email) : '';

    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: displayName,
        jobTitle: 'Home Inspector',
        ...(photoUrl ? { image: photoUrl } : {}),
        ...(licenseNumber ? {
            hasCredential: {
                '@type': 'EducationalOccupationalCredential',
                name: 'Home Inspector License',
                identifier: licenseNumber,
            },
        } : {}),
        areaServed: serviceAreas.map(a => ({ '@type': 'City', name: a.city, addressRegion: a.state })),
    };

    const title = `${displayName} · Home Inspector${cityList ? ' · ' + cityList : ''}`;
    const metaDescription = bio ? bio.slice(0, 160) : `Book a home inspection with ${displayName}${cityList ? ' in ' + cityList : ''}.`;
    const canonicalUrl = `https://${host}/inspector/${tenantSlug}/${slug ?? ''}`;

    // The base64-encoded email + obfuscation script keep raw addresses out of
    // the rendered HTML so naïve scrapers can't harvest mailto targets.
    const revealEmailScript = emailB64
        ? `(function(b){try{location.href='mailto:'+atob(b);}catch(_){}})('${emailB64}')`
        : '';

    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>{title}</title>
                <meta name="description" content={metaDescription} />
                <meta property="og:title" content={title} />
                <meta property="og:description" content={metaDescription} />
                <meta property="og:type" content="profile" />
                {photoUrl && <meta property="og:image" content={photoUrl} />}
                <link rel="canonical" href={canonicalUrl} />
                {slug && (
                    <link
                        rel="alternate"
                        type="text/calendar"
                        title={`${displayName} availability`}
                        href={`/inspector/${tenantSlug}/${slug}/calendar.ics`}
                    />
                )}
                {/* Customer-portal page — follow system color preference only;
                    no localStorage / no in-page toggle (per design system). */}
                <script dangerouslySetInnerHTML={{ __html: `(function(){var p=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-color-scheme',p?'dark':'light');})()`}} />
                <link rel="stylesheet" href="/fonts.css" />
                {raw(`<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`)}
                {raw(`<style>${HERO_STYLES}</style>`)}
            </head>
            <body>
                <header class="hero">
                    <div>
                        <h1 class="hero-name">{displayName}</h1>
                        <div class="meta-strip">
                            {licenseNumber && <span>License {licenseNumber}</span>}
                        </div>
                        {serviceAreas.length > 0 && (
                            <div style="margin-top: 12px;">
                                {serviceAreas.slice(0, 5).map(a => (
                                    <span class="area-chip">{a.city}, {a.state}</span>
                                ))}
                            </div>
                        )}
                    </div>
                    <div class="hero-photo-wrap">
                        {photoUrl ? (
                            <img class="hero-photo" src={photoUrl} alt={`${displayName}, home inspector`} />
                        ) : (
                            <div class="hero-photo hero-photo--placeholder" aria-hidden="true">{initials || 'I'}</div>
                        )}
                    </div>
                </header>

                {bio && <section class="bio">{bio}</section>}

                {services.length > 0 && (
                    <section class="services-grid">
                        {services.slice(0, 6).map(s => (
                            <article class="service-card" data-testid={`service-card-${s.name}`}>
                                <div class="service-duration">{fmtDuration(s.durationMinutes)}</div>
                                <div class="service-price">{fmtPrice(s.price)}</div>
                                <div class="service-name">{s.name}</div>
                            </article>
                        ))}
                    </section>
                )}

                <div class="trust-strip" data-testid="trust-strip">
                    <span>Insured</span>
                    <span>Licensed{licenseNumber ? ` · ${licenseNumber}` : ''}</span>
                    <span>{serviceAreas.length} service area{serviceAreas.length === 1 ? '' : 's'}</span>
                </div>

                <section class="cta-section">
                    {slug && (
                        <a class="cta-button" href={`/book/${tenantSlug}/${slug}`}>Book an inspection</a>
                    )}
                </section>

                <footer class="contact-footer">
                    {emailB64 && (
                        <span data-email-ascii={emailB64}>
                            <button type="button" class="contact-link" onclick={revealEmailScript}>
                                Contact via email
                            </button>
                        </span>
                    )}
                    {phone && <span style="margin-left: 16px;">{phone}</span>}
                </footer>
            </body>
        </html>
    );
};
