import { describe, it, expect } from 'vitest';
import { BookingEmbedPage } from '../../src/templates/pages/booking-embed';

function render(node: unknown): string {
    if (node && typeof node === 'object' && 'toString' in (node as object)) {
        return (node as { toString(): string }).toString();
    }
    return String(node);
}

describe('BookingEmbedPage — Sprint C-4', () => {
    it('has no nav, no sidebar, no main-layout chrome', () => {
        const html = render(BookingEmbedPage({
            slug: 'mike',
            inspectorId: 'u1',
            inspectorName: 'Mike Reynolds',
            tenantSubdomain: 'acme',
            siteKey: 'turnstile-key',
        }));
        expect(html).not.toContain('OpenInspection');
        expect(html).not.toMatch(/<nav\b/i);
        expect(html).not.toMatch(/<aside\b/i);
    });

    it('loads embed-resize.js + booking-embed-success.js', () => {
        const html = render(BookingEmbedPage({
            slug: 'mike',
            inspectorId: 'u1',
            inspectorName: 'Mike Reynolds',
            tenantSubdomain: 'acme',
            siteKey: 'turnstile-key',
        }));
        expect(html).toContain('/js/embed-resize.js');
        expect(html).toContain('/js/booking-embed-success.js');
    });

    it('inspectorName + slug rendered', () => {
        const html = render(BookingEmbedPage({
            slug: 'mike',
            inspectorId: 'u1',
            inspectorName: 'Mike Reynolds',
            tenantSubdomain: 'acme',
            siteKey: 'k',
        }));
        expect(html).toContain('Mike Reynolds');
        expect(html).toMatch(/value="mike"/);
    });

    it('renders compact variant when style=compact', () => {
        const html = render(BookingEmbedPage({
            slug: 'mike',
            inspectorId: 'u1',
            inspectorName: 'Mike Reynolds',
            tenantSubdomain: 'acme',
            siteKey: 'k',
            style: 'compact',
        }));
        expect(html).toMatch(/data-embed-style="compact"/);
        // compact variant collapses to a single CTA button by default
        expect(html).toMatch(/data-testid="embed-compact-cta"/);
    });

    it('full variant is the default', () => {
        const html = render(BookingEmbedPage({
            slug: 'mike',
            inspectorId: 'u1',
            inspectorName: 'Mike Reynolds',
            tenantSubdomain: 'acme',
            siteKey: 'k',
        }));
        expect(html).toMatch(/data-embed-style="full"/);
    });
});
