import { describe, it, expect } from 'vitest';
import { SettingsCatalogBookingPage } from '../../src/templates/pages/settings-catalog-booking';

/**
 * Agent Accounts A3 — Settings → Catalog → Booking concierge toggle.
 *
 * Frontend-design directive (non-negotiable per plan): include a tiny inline
 * 2-box flow diagram so single-toggle settings without context don't cause
 * regret-clicks.
 */
function render(node: JSX.Element): string {
    return String(node as unknown as { toString(): string });
}

describe('SettingsCatalogBookingPage — concierge toggle (A3)', () => {
    it('renders concierge-review toggle with the data-testid hook', () => {
        const html = render(SettingsCatalogBookingPage({
            tenantConfig: { conciergeReviewRequired: false },
        }));
        expect(html).toContain('data-testid="concierge-review-toggle"');
    });

    it('renders the inline 2-box flow diagram per directive', () => {
        const html = render(SettingsCatalogBookingPage({
            tenantConfig: { conciergeReviewRequired: false },
        }));
        expect(html).toContain('data-testid="concierge-flow-diagram"');
    });

    it('shows the agent->client (auto) flow when toggle is OFF', () => {
        const html = render(SettingsCatalogBookingPage({
            tenantConfig: { conciergeReviewRequired: false },
        }));
        expect(html).toMatch(/Agent submits/i);
        expect(html).toMatch(/Client confirms/i);
    });

    it('shows the agent->you->client (review) flow when toggle is ON', () => {
        const html = render(SettingsCatalogBookingPage({
            tenantConfig: { conciergeReviewRequired: true },
        }));
        expect(html).toMatch(/You review/i);
    });

    it('reflects current toggle state in the checkbox', () => {
        const onHtml = render(SettingsCatalogBookingPage({
            tenantConfig: { conciergeReviewRequired: true },
        }));
        const offHtml = render(SettingsCatalogBookingPage({
            tenantConfig: { conciergeReviewRequired: false },
        }));
        // The checkbox should be checked when the toggle is ON.
        expect(onHtml).toMatch(/checked\b/);
        // OFF page should NOT have the checkbox checked attribute on this input.
        expect(offHtml).not.toMatch(/data-testid="concierge-review-toggle"[^>]*\bchecked\b/);
    });
});
