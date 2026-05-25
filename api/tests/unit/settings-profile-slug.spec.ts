import { describe, it, expect } from 'vitest';
import { SettingsProfilePage } from '../../src/templates/pages/settings-profile';

/**
 * Booking #7 Sprint A — Settings → Profile booking slug card.
 *
 * The Hono JSX runtime returns a Promise<HtmlEscapedString> for async
 * components, but `SettingsProfilePage` itself is synchronous. We coerce its
 * return value to a string via `String()` so the test can run pure regex
 * assertions over the rendered HTML.
 */
function renderToString(node: JSX.Element): string {
    return String(node as unknown as { toString(): string });
}

describe('SettingsProfilePage — slug card', () => {
    it('renders booking slug input populated when user has slug', () => {
        const html = renderToString(
            SettingsProfilePage({ branding: undefined, currentSlug: 'john', tenantSubdomain: 'acme' }),
        );
        expect(html).toMatch(/data-testid="settings-slug-input"/);
        expect(html).toMatch(/value="john"/);
        // The booking link copy + the live link itself should both render.
        expect(html).toMatch(/\/book\/acme\/john/);
        expect(html).toMatch(/data-testid="settings-slug-link"/);
        expect(html).toMatch(/data-testid="settings-slug-copy"/);
    });

    it('renders empty slug input + helper hint when user has none', () => {
        const html = renderToString(
            SettingsProfilePage({ branding: undefined, currentSlug: null, tenantSubdomain: 'acme' }),
        );
        expect(html).toMatch(/data-testid="settings-slug-input"/);
        expect(html).toMatch(/data-testid="settings-slug-empty-hint"/);
    });

    it('loads the slug-check JS bundle', () => {
        const html = renderToString(
            SettingsProfilePage({ branding: undefined, currentSlug: null, tenantSubdomain: 'acme' }),
        );
        expect(html).toMatch(/\/js\/settings-profile-slug\.js/);
    });

    it('renders confirmation modal scaffolding for slug-change warnings', () => {
        const html = renderToString(
            SettingsProfilePage({ branding: undefined, currentSlug: 'john', tenantSubdomain: 'acme' }),
        );
        expect(html).toMatch(/data-testid="settings-slug-confirm-modal"/);
        expect(html).toMatch(/data-testid="settings-slug-confirm-yes"/);
        expect(html).toMatch(/data-testid="settings-slug-confirm-cancel"/);
        expect(html).toMatch(/Yes, change it/);
        expect(html).toMatch(/Keep current slug/);
    });

    it('exposes the saved slug via data-current-slug for the change-warning JS', () => {
        const html = renderToString(
            SettingsProfilePage({ branding: undefined, currentSlug: 'john', tenantSubdomain: 'acme' }),
        );
        expect(html).toMatch(/data-current-slug="john"/);
    });

    it('emits an empty data-current-slug when the user has no slug yet', () => {
        const html = renderToString(
            SettingsProfilePage({ branding: undefined, currentSlug: null, tenantSubdomain: 'acme' }),
        );
        expect(html).toMatch(/data-current-slug=""/);
    });
});
