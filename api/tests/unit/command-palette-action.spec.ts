import { describe, it, expect } from 'vitest';
import { CommandPalette } from '../../src/templates/components/command-palette';

function render(node: JSX.Element): string {
    return String(node as unknown as { toString(): string });
}

describe('CommandPalette — Copy my booking link action (Sprint B-1)', () => {
    it('exposes data-current-user-slug + data-booking-host + data-booking-tenant on the palette root for slug-aware actions', () => {
        const html = render(CommandPalette({ currentUserSlug: 'mike', bookingHost: 'app.inspectorhub.io', tenantSubdomain: 'acme' }));
        expect(html).toMatch(/data-current-user-slug="mike"/);
        expect(html).toMatch(/data-booking-host="app\.inspectorhub\.io"/);
        expect(html).toMatch(/data-booking-tenant="acme"/);
    });

    it('omits all attrs when slug is null', () => {
        const html = render(CommandPalette({ currentUserSlug: null, bookingHost: 'app.inspectorhub.io', tenantSubdomain: 'acme' }));
        expect(html).not.toMatch(/data-current-user-slug/);
        expect(html).not.toMatch(/data-booking-host/);
        expect(html).not.toMatch(/data-booking-tenant/);
    });

    it('renders without props (legacy callers — no booking action)', () => {
        const html = render(CommandPalette());
        expect(html).not.toMatch(/data-current-user-slug/);
        expect(html).not.toMatch(/data-booking-host/);
        // Sanity: palette markup still renders.
        expect(html).toMatch(/x-data="commandPalette"/);
    });
});
