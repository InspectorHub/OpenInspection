import { describe, it, expect } from 'vitest';
import { inspectorSignature } from '../../server/lib/inspector-signature';

const FULL_USER = {
    name: 'Mike Reynolds',
    email: 'mike@acme.test',
    phone: '(303) 555-0142',
    licenseNumber: 'TX-INSP-9001',
    slug: 'mike',
    tenantSlug: 'acme',
} as const;

const HOST = 'app.inspectorhub.io';

describe('inspectorSignature — Sprint B-4', () => {
    it('renders both HTML and plain-text variants', () => {
        const sig = inspectorSignature(FULL_USER, HOST);
        expect(sig.html).toContain('Mike Reynolds');
        expect(sig.html).toContain('TX-INSP-9001');
        expect(sig.html).toContain('mailto:mike@acme.test');
        expect(sig.html).toContain('tel:+13035550142'); // E.164-ish, helper strips non-digits
        expect(sig.html).toContain('https://app.inspectorhub.io/book/acme/mike');
        expect(sig.text).toContain('Mike Reynolds');
        expect(sig.text).toContain('Book again: https://app.inspectorhub.io/book/acme/mike');
        expect(sig.text).not.toContain('<a');
    });

    it('escapes HTML in name + license to prevent injection', () => {
        const sig = inspectorSignature({ ...FULL_USER, name: 'Mike <script>alert(1)</script>' }, HOST);
        expect(sig.html).not.toContain('<script>');
        expect(sig.html).toContain('&lt;script&gt;');
    });

    it('omits link line when slug is null', () => {
        const sig = inspectorSignature({ ...FULL_USER, slug: null }, HOST);
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

    it('snapshot — full canonical user', () => {
        const sig = inspectorSignature(FULL_USER, HOST);
        expect(sig).toMatchInlineSnapshot(`
          {
            "html": "<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-family:-apple-system,Segoe UI,sans-serif;font-size:13px;line-height:1.5;color:#0f172a"><strong>— Mike Reynolds</strong><br><span style="color:#475569">Licensed home inspector · TX-INSP-9001</span><br>📞 <a href="tel:+13035550142">(303) 555-0142</a> ✉️ <a href="mailto:mike@acme.test">mike@acme.test</a><br>Book again: <a href="https://app.inspectorhub.io/book/acme/mike">https://app.inspectorhub.io/book/acme/mike</a></div>",
            "text": "--
          — Mike Reynolds
          Licensed home inspector · TX-INSP-9001
          (303) 555-0142 · mike@acme.test
          Book again: https://app.inspectorhub.io/book/acme/mike",
          }
        `);
    });
});
