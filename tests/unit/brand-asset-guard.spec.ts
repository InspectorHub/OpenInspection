import { describe, it, expect } from 'vitest';

/**
 * Tests for the brand-asset R2 key guard in
 * server/api/public/inspector-profile.ts (brandAssetRoute handler).
 *
 * The guard allows only two key shapes:
 *   new:    {tenantId}/branding/logo-{uuid}.{ext}
 *   legacy: branding/{tenantId}/logo-{ts}.{ext}
 */

function isBrandingLogo(key: string): boolean {
    return (
        /^[^/.][^/]*\/branding\/logo-[^/]+$/.test(key) ||
        /^branding\/[^/.][^/]*\/logo-[^/]+$/.test(key)
    );
}

const TENANT = '00000000-0000-0000-0000-000000000001';

describe('brand-asset guard — new tenant-rooted layout', () => {
    it('allows new-shape logo key', () => {
        expect(isBrandingLogo(`${TENANT}/branding/logo-abc123.png`)).toBe(true);
    });

    it('allows new-shape key with UUID filename', () => {
        expect(isBrandingLogo(`${TENANT}/branding/logo-a1b2c3d4-e5f6-7890-abcd-ef1234567890.webp`)).toBe(true);
    });

    it('allows new-shape key with timestamp-style filename', () => {
        expect(isBrandingLogo(`${TENANT}/branding/logo-1718841600000.jpg`)).toBe(true);
    });

    it('rejects new-shape key with extra path segment after filename', () => {
        // Guard must not allow arbitrary sub-paths
        expect(isBrandingLogo(`${TENANT}/branding/logo-abc.png/extra`)).toBe(false);
    });

    it('rejects non-branding key under tenant namespace', () => {
        // e.g. inspection photo — must NOT pass the guard
        expect(isBrandingLogo(`${TENANT}/inspections/i-1/photos/m-1.jpg`)).toBe(false);
    });

    it('rejects inspector-photos key', () => {
        expect(isBrandingLogo(`${TENANT}/inspector-photos/user-id.jpg`)).toBe(false);
    });

    it('rejects key with branding prefix but not logo- filename', () => {
        expect(isBrandingLogo(`${TENANT}/branding/other-file.png`)).toBe(false);
    });
});

describe('brand-asset guard — legacy layout', () => {
    it('allows legacy-shape logo key', () => {
        expect(isBrandingLogo(`branding/${TENANT}/logo-1718841600000.png`)).toBe(true);
    });

    it('allows legacy-shape key with short tenant id', () => {
        expect(isBrandingLogo('branding/acme-co/logo-abc.jpg')).toBe(true);
    });

    it('rejects legacy key with extra path segment', () => {
        expect(isBrandingLogo(`branding/${TENANT}/logo-abc.png/extra`)).toBe(false);
    });
});

describe('brand-asset guard — rejection of arbitrary keys', () => {
    it('rejects empty string', () => {
        expect(isBrandingLogo('')).toBe(false);
    });

    it('rejects bare filename with no path', () => {
        expect(isBrandingLogo('logo-abc.png')).toBe(false);
    });

    it('rejects path traversal attempt', () => {
        expect(isBrandingLogo('../branding/logo-abc.png')).toBe(false);
    });

    it('rejects report PDF key', () => {
        expect(isBrandingLogo(`${TENANT}/inspections/i-1/report/3.pdf`)).toBe(false);
    });
});
