/**
 * Credential badges are rendered TINY and stored as whatever was uploaded.
 *
 * Nothing crops, resizes or re-encodes a badge on the way in: the uploader keeps
 * the original format on purpose (a transparent PNG or an SVG must survive
 * intact), and the server writes the bytes straight to R2 behind a 2 MB cap and
 * a mime allowlist. Meanwhile every surface that renders one scales it to
 * between 28 and 40 CSS pixels.
 *
 * So a 2 MB photograph — which the allowlist permits, and which people do
 * upload — is delivered in full and then drawn at 28px. In an inbox that is 2 MB
 * per recipient per send, because mail clients have no `srcset` and fetch
 * whatever the `src` names.
 *
 * Transforming at SERVE time rather than at upload time is what fixes the badges
 * ALREADY in R2, which an upload-time rule cannot reach.
 */

/** The CSS height each surface draws a badge at, and the width we serve for it. */
export const BADGE_VARIANTS = {
    /** `inspector-signature.ts` renders `height:28px`. */
    email: { width: 56, format: 'image/png' as const },
    /** `ReportSignatureBlock` renders `h-8` (32px). */
    reportSignature: { width: 64, format: 'image/webp' as const },
    /** `CredentialBadges` renders `h-10` (40px). */
    reportCover: { width: 80, format: 'image/webp' as const },
} as const;

export type BadgeVariant = keyof typeof BADGE_VARIANTS;

/**
 * EMAIL GETS PNG, NOT WEBP, and that is not a rounding error.
 *
 * Everything else on the web can take WebP. Mail is the one medium where the
 * renderer is somebody else's decade-old client: Outlook on Windows draws with
 * Word's engine and shows a broken-image box for WebP. A badge that fails to
 * render in an inbox is worse than a badge that is 30% larger, so the email
 * variant stays PNG — which also keeps transparency, the whole point of a badge.
 */
export function badgeFormat(variant: BadgeVariant): string {
    return BADGE_VARIANTS[variant].format;
}

/**
 * Append the variant to a `/api/public/brand-asset` URL.
 *
 * A no-op for anything that is not one of our brand-asset paths, so a caller
 * holding an absolute or already-transformed URL passes it through unchanged.
 */
export function badgeUrl(imageUrl: string | null, variant: BadgeVariant): string | null {
    if (!imageUrl || !imageUrl.startsWith('/api/public/brand-asset?')) return imageUrl;
    return `${imageUrl}&v=${variant}`;
}

/**
 * Resolve a `?v=` query value to a transform, or null.
 *
 * Null means "serve the original": an unknown variant, or none asked for. Never
 * an error — a badge that fails to load is a worse outcome than a badge that is
 * bigger than it needed to be, so every uncertain path here degrades to the
 * bytes that were uploaded.
 */
export function resolveBadgeVariant(
    raw: string | undefined,
): { width: number; format: string } | null {
    if (!raw) return null;
    // `Object.hasOwn`, not a bare lookup: `BADGE_VARIANTS['__proto__']` resolves
    // to `Object.prototype`, which is TRUTHY — so a bare index would take the
    // transform branch with `{ width: undefined, format: undefined }` for a
    // caller who asked for `?v=__proto__`. The route's zod enum already bars
    // that, but this function is exported and reachable on its own.
    if (!Object.hasOwn(BADGE_VARIANTS, raw)) return null;
    const v = BADGE_VARIANTS[raw as BadgeVariant];
    return { width: v.width, format: v.format };
}

/**
 * SVG is left ALONE.
 *
 * It is already resolution-independent, so there is nothing to gain, and
 * rasterising it would throw away the one property that makes it the format the
 * uploader recommends. Detected on the stored content type rather than the key,
 * because the key's extension is derived from that content type at upload and
 * the content type is what the browser will act on.
 */
export function isVectorBadge(contentType: string | null | undefined): boolean {
    return (contentType ?? '').includes('svg');
}
