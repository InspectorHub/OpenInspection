import { describe, it, expect } from 'vitest';
import { SettingsProfilePage } from '../../src/templates/pages/settings-profile';

function render(node: JSX.Element): string {
    return String(node as unknown as { toString(): string });
}

describe('SettingsProfilePage — signature card (Sprint B-4b)', () => {
    it('renders the My email signature card below the slug card', () => {
        const html = render(SettingsProfilePage({
            currentSlug: 'mike',
            tenantSubdomain: 'acme',
            currentUser: { name: 'Mike', email: 'mike@acme.test', phone: '(303) 555-0142', licenseNumber: 'TX-9001' },
        }));
        expect(html).toMatch(/data-testid="settings-signature-card"/);
        expect(html).toMatch(/data-testid="settings-signature-html-preview"/);
        expect(html).toMatch(/data-testid="settings-signature-text-preview"/);
        expect(html).toMatch(/data-testid="settings-signature-copy-html"/);
        expect(html).toMatch(/data-testid="settings-signature-copy-text"/);
    });

    it('exposes user data via data-* attributes for the JS to render preview client-side', () => {
        const html = render(SettingsProfilePage({
            currentSlug: 'mike',
            tenantSubdomain: 'acme',
            currentUser: { name: 'Mike', email: 'mike@acme.test', phone: '(303) 555-0142', licenseNumber: 'TX-9001' },
        }));
        expect(html).toMatch(/data-sig-name="Mike"/);
        expect(html).toMatch(/data-sig-email="mike@acme.test"/);
        expect(html).toMatch(/data-sig-phone="\(303\) 555-0142"/);
        expect(html).toMatch(/data-sig-license="TX-9001"/);
        expect(html).toMatch(/data-sig-slug="mike"/);
        expect(html).toMatch(/data-sig-host="inspectorhub\.io"/);
        expect(html).toMatch(/data-sig-tenant="acme"/);
    });

    it('omits the card when user has no slug yet', () => {
        const html = render(SettingsProfilePage({
            currentSlug: null,
            tenantSubdomain: 'acme',
            currentUser: { name: 'Mike', email: 'mike@acme.test' },
        }));
        expect(html).not.toMatch(/data-testid="settings-signature-card"/);
    });
});
