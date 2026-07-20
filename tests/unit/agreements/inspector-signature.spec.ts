import { describe, it, expect } from 'vitest';
import { inspectorSignature } from '../../../server/lib/inspector-signature';

const FULL_USER = {
    name: 'Mike Reynolds',
    email: 'mike@acme.test',
    phone: '(303) 555-0142',
    licenseNumber: 'TX-INSP-9001',
    slug: 'mike',        // retained for API stability (DB-12); no longer used for URL
    tenantSlug: 'acme',
} as const;

const HOST = 'app.inspectorhub.io';

describe('inspectorSignature — Sprint B-4 / DB-12', () => {
    it('renders both HTML and plain-text variants', () => {
        const sig = inspectorSignature(FULL_USER, HOST);
        expect(sig.html).toContain('Mike Reynolds');
        expect(sig.html).toContain('TX-INSP-9001');
        expect(sig.html).toContain('mailto:mike@acme.test');
        expect(sig.html).toContain('tel:+13035550142'); // E.164-ish, helper strips non-digits
        // DB-12 — company-level URL only (no /mike suffix)
        expect(sig.html).toContain('https://app.inspectorhub.io/book/acme');
        expect(sig.html).not.toContain('/book/acme/mike');
        expect(sig.text).toContain('Mike Reynolds');
        // DB-12 — company-level URL in plain text
        expect(sig.text).toContain('Book again: https://app.inspectorhub.io/book/acme');
        expect(sig.text).not.toContain('/book/acme/mike');
        expect(sig.text).not.toContain('<a');
    });

    it('escapes HTML in name + license to prevent injection', () => {
        const sig = inspectorSignature({ ...FULL_USER, name: 'Mike <script>alert(1)</script>' }, HOST);
        expect(sig.html).not.toContain('<script>');
        expect(sig.html).toContain('&lt;script&gt;');
    });

    it('renders credential badges: image (absolute URL) in HTML + all credentials as text in both variants', () => {
        const sig = inspectorSignature({
            ...FULL_USER,
            credentials: [
                { label: 'InterNACHI CPI', memberNumber: '12345', imageUrl: '/api/public/brand-asset?key=t%2Fcredentials%2Fc1%2Flogo-a.png' },
                { label: 'TX License', memberNumber: '22841', imageUrl: null },
            ],
        }, HOST);
        // image credential -> absolutized <img> in HTML
        expect(sig.html).toContain('<img src="https://app.inspectorhub.io/api/public/brand-asset');
        // every credential (image + text) also as text in BOTH variants (blocked image never loses it)
        expect(sig.html).toContain('InterNACHI CPI #12345');
        expect(sig.html).toContain('TX License #22841');
        expect(sig.text).toContain('InterNACHI CPI #12345');
        expect(sig.text).toContain('TX License #22841');
        expect(sig.text).not.toContain('<img');
    });

    it('omits the credential block entirely when there are no credentials', () => {
        const sig = inspectorSignature(FULL_USER, HOST);
        expect(sig.html).not.toContain('brand-asset');
    });

    it('renders the book link when tenantSlug is set (slug presence does not matter)', () => {
        // DB-12 — link depends only on tenantSlug, not slug
        const withSlug = inspectorSignature({ ...FULL_USER, slug: 'mike' }, HOST);
        expect(withSlug.html).toContain('/book/acme');
        const withoutSlug = inspectorSignature({ ...FULL_USER, slug: null }, HOST);
        expect(withoutSlug.html).toContain('/book/acme');
    });

    it('omits link line when tenantSlug is null', () => {
        const sig = inspectorSignature({ ...FULL_USER, tenantSlug: null }, HOST);
        expect(sig.html).not.toContain('/book/');
        expect(sig.text).not.toContain('Book again');
    });

    it('omits license line when licenseNumber is null', () => {
        const sig = inspectorSignature({ ...FULL_USER, licenseNumber: null }, HOST);
        expect(sig.html).not.toContain('Licensed home inspector');
        expect(sig.text).not.toContain('Licensed home inspector');
    });

    it('omits everything when user has no fields at all', () => {
        const sig = inspectorSignature({}, HOST);
        // Only the wrapper div / "--" leader remain.
        expect(sig.html).toContain('<div');
        expect(sig.text).toBe('--');
    });

    it('snapshot — full canonical user (DB-12: company-level URL)', () => {
        const sig = inspectorSignature(FULL_USER, HOST);
        expect(sig).toMatchInlineSnapshot(`
          {
            "html": "<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-family:-apple-system,Segoe UI,sans-serif;font-size:13px;line-height:1.5;color:#0f172a"><strong>— Mike Reynolds</strong><br><span style="color:#475569">Licensed home inspector · TX-INSP-9001</span><br>📞 <a href="tel:+13035550142">(303) 555-0142</a> ✉️ <a href="mailto:mike@acme.test">mike@acme.test</a><br>Book again: <a href="https://app.inspectorhub.io/book/acme">https://app.inspectorhub.io/book/acme</a></div>",
            "text": "--
          — Mike Reynolds
          Licensed home inspector · TX-INSP-9001
          (303) 555-0142 · mike@acme.test
          Book again: https://app.inspectorhub.io/book/acme",
          }
        `);
    });
});
