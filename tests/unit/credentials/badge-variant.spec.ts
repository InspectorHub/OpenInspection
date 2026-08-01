/**
 * Serving a credential badge at the size it is actually drawn.
 *
 * Nothing crops or compresses a badge on the way in — deliberately, so a
 * transparent PNG or an SVG survives intact — and every surface then scales it
 * to between 28 and 40 CSS pixels. A 2 MB photograph (which the mime allowlist
 * permits, and which people upload) was therefore delivered whole and drawn at
 * 28px. In an inbox that is 2 MB per recipient per send, because mail clients
 * have no `srcset` and fetch whatever the `src` names.
 */
import { describe, it, expect } from 'vitest';
import {
    BADGE_VARIANTS, badgeFormat, badgeUrl, resolveBadgeVariant, isVectorBadge,
} from '../../../server/lib/media/badge-variant';

const BASE = '/api/public/brand-asset?key=t1%2Fcredentials%2Fa%2Flogo.png';

describe('badge variants', () => {
    it('serves at least twice the CSS height each surface draws', () => {
        // The rendered sizes are literals in three different files
        // (`height:28px` inline, `h-8`, `h-10`). If one of them grows, this is
        // the spec that should make someone revisit the width.
        expect(BADGE_VARIANTS.email.width).toBeGreaterThanOrEqual(28 * 2);
        expect(BADGE_VARIANTS.reportSignature.width).toBeGreaterThanOrEqual(32 * 2);
        expect(BADGE_VARIANTS.reportCover.width).toBeGreaterThanOrEqual(40 * 2);
    });

    it('gives EMAIL png and the web surfaces webp', () => {
        // Outlook on Windows draws with Word's engine and shows a broken-image
        // box for WebP. A badge that fails to render in an inbox is worse than
        // one that is 30% larger — and PNG keeps the transparency that makes it
        // a badge rather than a white rectangle.
        expect(badgeFormat('email')).toBe('image/png');
        expect(badgeFormat('reportSignature')).toBe('image/webp');
        expect(badgeFormat('reportCover')).toBe('image/webp');
    });
});

describe('badgeUrl', () => {
    it('appends the variant to a brand-asset url', () => {
        expect(badgeUrl(BASE, 'email')).toBe(`${BASE}&v=email`);
        expect(badgeUrl(BASE, 'reportCover')).toBe(`${BASE}&v=reportCover`);
    });

    it('passes through anything that is not a brand-asset path', () => {
        // A caller may hold an absolute url (the email signature absolutises
        // against the deployment host) or an external one. Rewriting those
        // would produce a query the other end does not understand.
        expect(badgeUrl('https://cdn.example/logo.png', 'email')).toBe('https://cdn.example/logo.png');
        expect(badgeUrl(null, 'email')).toBeNull();
    });
});

describe('resolveBadgeVariant', () => {
    it('resolves the three known variants', () => {
        expect(resolveBadgeVariant('email')).toEqual({ width: 56, format: 'image/png' });
        expect(resolveBadgeVariant('reportCover')).toEqual({ width: 80, format: 'image/webp' });
    });

    it('returns null for absent or unknown, so the original is served', () => {
        // Fail OPEN. A badge larger than it needed to be is a cost; a badge
        // that does not render is a broken document.
        expect(resolveBadgeVariant(undefined)).toBeNull();
        expect(resolveBadgeVariant('')).toBeNull();
        expect(resolveBadgeVariant('enormous')).toBeNull();
        expect(resolveBadgeVariant('__proto__')).toBeNull();
    });
});

describe('isVectorBadge', () => {
    it('leaves SVG alone', () => {
        // Already resolution-independent, so there is nothing to gain — and
        // rasterising it would throw away the property that makes it the format
        // the uploader recommends in the first place.
        expect(isVectorBadge('image/svg+xml')).toBe(true);
    });

    it('transforms raster formats', () => {
        for (const t of ['image/png', 'image/jpeg', 'image/webp']) {
            expect(isVectorBadge(t), t).toBe(false);
        }
    });

    it('treats a missing content type as raster rather than crashing', () => {
        expect(isVectorBadge(null)).toBe(false);
        expect(isVectorBadge(undefined)).toBe(false);
    });
});
