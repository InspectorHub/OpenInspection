import { describe, it, expect } from 'vitest';
import { SettingsProfilePage } from '../../src/templates/pages/settings-profile';

function render(node: unknown): string {
    if (node && typeof node === 'object' && 'toString' in (node as object)) {
        return (node as { toString(): string }).toString();
    }
    return String(node);
}

describe('SettingsProfilePage — public profile section (Sprint C-1)', () => {
    it('renders bio textarea + service-areas list editor + photo uploader', () => {
        const html = render(SettingsProfilePage({
            currentSlug: 'mike',
            tenantSubdomain: 'acme',
            currentUser: {
                name: 'Mike',
                email: 'mike@acme.test',
                phone: null,
                licenseNumber: null,
            },
            currentProfile: {
                bio: 'My bio',
                photoUrl: 'https://r2/me.jpg',
                serviceAreas: [{ city: 'Austin', state: 'TX', zip: '78701' }],
            },
        }));
        expect(html).toMatch(/data-testid="settings-profile-bio"/);
        expect(html).toMatch(/data-testid="settings-profile-photo-uploader"/);
        expect(html).toMatch(/data-testid="settings-profile-areas-editor"/);
        expect(html).toContain('My bio');
        expect(html).toMatch(/me\.jpg/);
        expect(html).toContain('Austin');
    });

    it('renders the section even when currentProfile is missing (greenfield user)', () => {
        const html = render(SettingsProfilePage({
            currentSlug: null,
            tenantSubdomain: 'acme',
            currentUser: null,
        }));
        expect(html).toMatch(/data-testid="settings-profile-bio"/);
        expect(html).toMatch(/data-testid="settings-profile-photo-uploader"/);
        expect(html).toMatch(/data-testid="settings-profile-areas-editor"/);
    });

    it('shows live character counter for bio (max 600 chars)', () => {
        const html = render(SettingsProfilePage({
            currentSlug: 'mike',
            tenantSubdomain: 'acme',
            currentUser: null,
            currentProfile: { bio: 'short', photoUrl: null, serviceAreas: [] },
        }));
        expect(html).toMatch(/maxlength="600"/);
        expect(html).toMatch(/data-testid="settings-profile-bio-counter"/);
    });
});
