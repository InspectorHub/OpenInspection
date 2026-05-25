import { describe, it, expect } from 'vitest';
import { InspectorProfilePage, type CatalogService } from '../../src/templates/pages/inspector-profile';
import type { InspectorProfile } from '../../src/services/user.service';

function render(node: unknown): string {
    if (node && typeof node === 'object' && 'toString' in (node as object)) {
        return (node as { toString(): string }).toString();
    }
    return String(node);
}

const PROFILE: InspectorProfile = {
    id: 'u1',
    name: 'Mike Reynolds',
    bio: 'Texas-licensed home inspector since 2018.',
    photoUrl: 'https://r2.example/photos/mike.jpg',
    licenseNumber: 'TX-9001',
    email: 'mike@acme.test',
    phone: '(303) 555-0142',
    slug: 'mike',
    serviceAreas: [
        { city: 'Austin', state: 'TX', zip: '78701' },
        { city: 'Round Rock', state: 'TX', zip: '78664' },
    ],
};

const SERVICES: CatalogService[] = [
    { name: 'Standard Home Inspection', durationMinutes: 180, price: 47500 },
    { name: 'Pre-Listing Inspection',   durationMinutes: 150, price: 39500 },
    { name: 'New Construction',         durationMinutes: 240, price: 65000 },
];

describe('InspectorProfilePage — Sprint C-1', () => {
    it('renders editorial hero with oversized name + photo + license', () => {
        const html = render(InspectorProfilePage({ profile: PROFILE, services: SERVICES, host: 'app.inspectorhub.io', tenantSlug: 'acme' }));
        expect(html).toContain('Mike Reynolds');
        expect(html).toContain('TX-9001');
        expect(html).toContain('Austin');
        expect(html).toContain('mike.jpg');
        expect(html).toMatch(/font-family:\s*['"]?Fraunces/);
    });

    it('renders services as 3-up card grid (not table)', () => {
        const html = render(InspectorProfilePage({ profile: PROFILE, services: SERVICES, host: 'app.inspectorhub.io', tenantSlug: 'acme' }));
        expect(html).toMatch(/data-testid="service-card-Standard Home Inspection"/);
        expect(html).toMatch(/data-testid="service-card-Pre-Listing Inspection"/);
        expect(html).toMatch(/data-testid="service-card-New Construction"/);
        expect(html).not.toMatch(/<table/i);
    });

    it('renders trust strip above CTA', () => {
        const html = render(InspectorProfilePage({ profile: PROFILE, services: SERVICES, host: 'app.inspectorhub.io', tenantSlug: 'acme' }));
        expect(html).toMatch(/data-testid="trust-strip"/);
        expect(html).toMatch(/Insured/);
        expect(html).toMatch(/Licensed/);
    });

    it('CTA links to /book/<tenant>/<slug>', () => {
        const html = render(InspectorProfilePage({ profile: PROFILE, services: SERVICES, host: 'app.inspectorhub.io', tenantSlug: 'acme' }));
        expect(html).toMatch(/href="\/book\/acme\/mike"/);
        expect(html).toMatch(/Book an inspection/);
    });

    it('emits JSON-LD Person schema for SEO', () => {
        const html = render(InspectorProfilePage({ profile: PROFILE, services: SERVICES, host: 'app.inspectorhub.io', tenantSlug: 'acme' }));
        expect(html).toMatch(/<script type="application\/ld\+json">/);
        expect(html).toMatch(/"@type":\s*"Person"/);
        expect(html).toMatch(/"jobTitle":\s*"Home Inspector"/);
    });

    it('email rendered as base64 data attribute (anti-scraping)', () => {
        const html = render(InspectorProfilePage({ profile: PROFILE, services: SERVICES, host: 'app.inspectorhub.io', tenantSlug: 'acme' }));
        // base64 of "mike@acme.test"
        expect(html).toMatch(/data-email-ascii="bWlrZUBhY21lLnRlc3Q="/);
        expect(html).not.toContain('mike@acme.test'); // raw email NOT in HTML
    });

    it('renders gracefully with missing photo + bio', () => {
        const minimal: InspectorProfile = { ...PROFILE, photoUrl: null, bio: null };
        const html = render(InspectorProfilePage({ profile: minimal, services: SERVICES, host: 'app.inspectorhub.io', tenantSlug: 'acme' }));
        expect(html).toContain('Mike Reynolds');
        expect(html).not.toContain('null');
    });

    it('mobile responsive — 600px breakpoint reduces hero photo to 120px and stacks services', () => {
        const html = render(InspectorProfilePage({ profile: PROFILE, services: SERVICES, host: 'app.inspectorhub.io', tenantSlug: 'acme' }));
        expect(html).toMatch(/@media[^{]*max-width:\s*600px/);
        // hero-photo gets 120px max in mobile media query
        expect(html).toMatch(/max-width:\s*120px/);
        // services-grid switches to single column
        expect(html).toMatch(/grid-template-columns:\s*1fr/);
    });

    it('canonical link + alternate ICS link for SEO + calendar discovery', () => {
        const html = render(InspectorProfilePage({ profile: PROFILE, services: SERVICES, host: 'app.inspectorhub.io', tenantSlug: 'acme' }));
        expect(html).toMatch(/<link rel="canonical" href="https:\/\/app\.inspectorhub\.io\/inspector\/acme\/mike"/);
        expect(html).toMatch(/<link rel="alternate" type="text\/calendar"[^>]*href="\/inspector\/acme\/mike\/calendar\.ics"/);
    });
});
