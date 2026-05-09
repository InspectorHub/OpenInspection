/**
 * Iter-2 soft-error pages — FeatureDisabledPage render tests.
 *
 * Snapshots the disabled-feature page across the two friendly variants
 * surfaced by Bug #13 (admin/inspector hits Repair List sub-route while
 * the tenant toggle is off) and Bug #14 (customer hits the public
 * repair-request URL while the customer-export toggle is off).
 */
import { describe, it, expect } from 'vitest';
import { FeatureDisabledPage } from '../../src/templates/pages/feature-disabled';

function render(node: unknown): string {
    return String(node);
}

describe('FeatureDisabledPage', () => {
    it('renders the inspector-facing repair-list disabled copy + settings CTA', () => {
        const html = render(FeatureDisabledPage({
            from: 'repair-list',
        }));
        expect(html).toContain('Repair List is disabled');
        expect(html).toContain('Settings');
        expect(html).toContain('Workspace');
        expect(html).toContain('Reports');
        // CTA links to the deep-link anchor on settings.
        expect(html).toContain('href="/settings/workspace/reports#repair-list"');
        expect(html).toContain('Go to settings');
    });

    it('renders the customer-facing repair-request disabled copy without an inspector CTA', () => {
        const html = render(FeatureDisabledPage({
            from: 'customer-repair-request',
        }));
        expect(html).toContain('Repair request unavailable');
        // Customer copy must invite contact, never settings deep-link.
        // hono/jsx HTML-encodes apostrophes — check both forms.
        expect(html.includes("inspector hasn't enabled") || html.includes('inspector hasn&#39;t enabled')).toBe(true);
        expect(html).not.toContain('href="/settings/');
    });

    it('falls back to a generic friendly disabled-feature message for unknown keys', () => {
        const html = render(FeatureDisabledPage({
            from: 'mystery-key',
        }));
        // Generic title + body still render.
        expect(html).toContain('Feature unavailable');
        expect(html).toContain('not currently enabled');
    });

    it('respects branding siteName in the document title', () => {
        const html = render(FeatureDisabledPage({
            from: 'repair-list',
            branding: {
                siteName: 'Acme Inspections',
                primaryColor: '#6366f1',
            } as never,
        }));
        expect(html).toContain('Acme Inspections | Repair List is disabled');
    });
});
