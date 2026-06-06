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

export interface SignatureUser {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
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

export function inspectorSignature(user: SignatureUser, host: string): SignatureOutput {
    const name      = user.name          ? escapeHtml(user.name)          : null;
    const license   = user.licenseNumber ? escapeHtml(user.licenseNumber) : null;
    const email     = user.email         ? escapeHtml(user.email)         : null;
    const phoneRaw  = user.phone         ? escapeHtml(user.phone)         : null;
    const phoneE164 = phoneTel(user.phone ?? null);
    // DB-12 / IA-26 — the per-inspector URL is retired; link to the company
    // booking page instead. tenantSlug alone is sufficient now.
    const link      = user.tenantSlug
        ? `https://${host}/book/${escapeHtml(user.tenantSlug)}`
        : null;

    const htmlLines: string[] = [];
    if (name)    htmlLines.push(`<strong>— ${name}</strong>`);
    if (license) htmlLines.push(`<span style="color:#475569">Licensed home inspector · ${license}</span>`);
    const contactBits: string[] = [];
    if (phoneRaw && phoneE164) contactBits.push(`📞 <a href="tel:${phoneE164}">${phoneRaw}</a>`);
    if (email)                 contactBits.push(`✉️ <a href="mailto:${email}">${email}</a>`);
    if (contactBits.length) htmlLines.push(contactBits.join(' '));
    if (link) htmlLines.push(`Book again: <a href="${link}">${link}</a>`);
    const html = `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-family:-apple-system,Segoe UI,sans-serif;font-size:13px;line-height:1.5;color:#0f172a">${htmlLines.join('<br>')}</div>`;

    const textLines: string[] = ['--'];
    if (user.name)    textLines.push(`— ${user.name}`);
    if (user.licenseNumber) textLines.push(`Licensed home inspector · ${user.licenseNumber}`);
    if (user.phone || user.email) {
        const cb: string[] = [];
        if (user.phone) cb.push(user.phone);
        if (user.email) cb.push(user.email);
        textLines.push(cb.join(' · '));
    }
    // DB-12 / IA-26 — company-level URL only; per-inspector slug retired.
    if (user.tenantSlug) {
        textLines.push(`Book again: https://${host}/book/${user.tenantSlug}`);
    }
    const text = textLines.join('\n');

    return { html, text };
}
