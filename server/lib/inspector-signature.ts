/**
 * Sprint B-4 — single source of truth for the inspector business-card block
 * that's pasted into outbound automation footers (B-4a + B-4c) and previewed
 * in Settings → Profile (B-4b).
 *
 * Returns both an HTML version (for emails / clipboard-as-rich) and a plain
 * text version (for clipboard-as-plain + degraded mail clients). Both
 * variants escape user-controlled fields (name / license) to defuse the
 * injection vector that comes from inspectors typing arbitrary characters.
 *
 * Keep `public/js/settings-profile-signature.js` in sync — it mirrors this
 * helper client-side for the live preview card.
 *
 * DB-12 / IA-26 — "Book again" links now point to the company-level booking
 * page (`/book/<tenantSlug>`). The per-inspector URL (`/book/<t>/<slug>`) is
 * retired. SignatureUser.slug is still accepted but is no longer read.
 */

import { badgeUrl } from './media/badge-variant';

export interface SignatureUser {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    /**
     * @deprecated FROZEN. `users.license_number` is retired — the licence is a
     * credential row now and arrives in `credentials`. The field stays on the
     * type only so a caller that still passes it does not fail to compile; it
     * is not rendered. Remove once no caller sets it.
     */
    licenseNumber?: string | null;
    /**
     * DB-12 / IA-26 — inspector booking slugs are retired. This field is
     * retained so existing callers do not need to change their call sites, but
     * the signature helper no longer uses it for the booking URL.
     * @deprecated Kept for API stability; ignored when building the booking link.
     */
    slug?: string | null;
    /** Tenant slug — builds the company-level booking URL (`/book/<tenant>`). */
    tenantSlug?: string | null;
    /** Per-inspector opt-in for the email footer; when false the footer is omitted. */
    signatureEnabled?: boolean | null;
    /** Report Style Presets (Spec B) — the inspector's active credentials. Image
     *  badges render in HTML (absolutized against host); all credentials also
     *  render as text in both variants so a blocked image never loses them. */
    credentials?: Array<{ label: string; memberNumber: string | null; imageUrl: string | null }> | null;
}

export interface SignatureOutput {
    html: string;
    text: string;
}

const escapeHtml = (s: string): string => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Best-effort E.164 builder. Strips non-digits and assumes a US country code
 * when the result is a 10-digit number. Returns null when there are too few
 * digits to be a phone number; callers should drop the link in that case.
 */
const phoneTel = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 7) return null;
    return `+1${digits.slice(-10)}`;
};

export interface SignatureRenderOptions {
    /**
     * Where badge `<img>` URLs point, when that is not where the LINKS point.
     *
     * The two have different requirements and only one caller notices. An EMAIL
     * needs both absolute — a mail client renders the footer wherever the
     * recipient happens to be, and resolves nothing against an origin of ours.
     * The SETTINGS PREVIEW is drawn by a browser already sitting on this app's
     * origin, so it passes `''` and its badges become relative: they then load
     * from whatever origin is actually serving the page.
     *
     * Absolutizing them was what broke the preview. `host` there comes from the
     * in-process API request, which in local dev reports a different port than
     * the browser is on, so every badge resolved to a port with nothing behind
     * it — broken-image icons on the one surface whose entire job is showing
     * what the recipient will see. Relative cannot have that class of bug,
     * in dev or in production.
     */
    assetOrigin?: string;
}

export function inspectorSignature(
    user: SignatureUser,
    host: string,
    { assetOrigin = `https://${host}` }: SignatureRenderOptions = {},
): SignatureOutput {
    const origin = `https://${host}`;
    const name      = user.name          ? escapeHtml(user.name)          : null;
    const email     = user.email         ? escapeHtml(user.email)         : null;
    const phoneRaw  = user.phone         ? escapeHtml(user.phone)         : null;
    const phoneE164 = phoneTel(user.phone ?? null);
    // DB-12 / IA-26 — the per-inspector URL is retired; link to the company
    // booking page instead. tenantSlug alone is sufficient now.
    const link      = user.tenantSlug
        ? `${origin}/book/${escapeHtml(user.tenantSlug)}`
        : null;

    const htmlLines: string[] = [];
    if (name)    htmlLines.push(`<strong>— ${name}</strong>`);
    // The hard-coded "Licensed home inspector · <n>" line is gone: the licence
    // is a credential row and renders below with the rest of them, under the
    // label the backfill gave it. Two sources for one line is how a recipient
    // ends up reading the licence twice.
    // Credential badges (Spec B): images in HTML, all credentials also as text.
    const creds = (user.credentials ?? []).filter((c) => c.imageUrl || (c.label ?? '').trim());
    if (creds.length) {
        const imgs = creds
            .filter((c) => c.imageUrl)
            .map((c) => {
                // The EMAIL variant: PNG (Outlook cannot draw WebP) at twice the
                // 28px it is about to be scaled to. Without this the recipient
                // downloads whatever was uploaded — up to 2 MB — to render a
                // chip the height of a line of text.
                const sized = badgeUrl(c.imageUrl, 'email') ?? c.imageUrl!;
                const abs = sized.startsWith('/') ? `${assetOrigin}${sized}` : sized;
                return `<img src="${escapeHtml(abs)}" alt="${escapeHtml(c.label || 'Credential')}" style="height:28px;width:auto;vertical-align:middle;margin-right:6px">`;
            })
            .join('');
        if (imgs) htmlLines.push(imgs);
        const credText = creds.map((c) => (c.memberNumber ? `${c.label} #${c.memberNumber}` : c.label)).filter((t) => t.trim()).join(' · ');
        if (credText) htmlLines.push(`<span style="color:#475569">${escapeHtml(credText)}</span>`);
    }
    const contactBits: string[] = [];
    if (phoneRaw && phoneE164) contactBits.push(`📞 <a href="tel:${phoneE164}">${phoneRaw}</a>`);
    if (email)                 contactBits.push(`✉️ <a href="mailto:${email}">${email}</a>`);
    if (contactBits.length) htmlLines.push(contactBits.join(' '));
    if (link) htmlLines.push(`Book again: <a href="${link}">${link}</a>`);
    const html = `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-family:-apple-system,Segoe UI,sans-serif;font-size:13px;line-height:1.5;color:#0f172a">${htmlLines.join('<br>')}</div>`;

    const textLines: string[] = ['--'];
    if (user.name)    textLines.push(`— ${user.name}`);
    const credTextAll = (user.credentials ?? [])
        .map((c) => (c.memberNumber ? `${c.label} #${c.memberNumber}` : c.label))
        .filter((t) => (t ?? '').trim())
        .join(' · ');
    if (credTextAll) textLines.push(credTextAll);
    if (user.phone || user.email) {
        const cb: string[] = [];
        if (user.phone) cb.push(user.phone);
        if (user.email) cb.push(user.email);
        textLines.push(cb.join(' · '));
    }
    // DB-12 / IA-26 — company-level URL only; per-inspector slug retired.
    if (user.tenantSlug) {
        textLines.push(`Book again: ${origin}/book/${user.tenantSlug}`);
    }
    const text = textLines.join('\n');

    return { html, text };
}
