import { describe, it, expect } from 'vitest';
import { ConciergeConfirmPage, ConciergeConfirmPageProps } from '../../src/templates/pages/concierge-confirm';

/**
 * Agent Accounts A3 — magic-link landing page snapshot.
 *
 * Frontend-design directives (per plan):
 *   1. Lead with inspector photo + name + property + date summary card
 *   2. Inline agreement-snippet preview when agreementRequired
 *   3. Confirm CTA full-width on mobile; collapsible summary on mobile
 */
function render(node: JSX.Element): string {
    return String(node as unknown as { toString(): string });
}

const BASE: ConciergeConfirmPageProps = {
    token: 'tok-abc-123',
    inspector: {
        name: 'Mike Reynolds',
        photoUrl: 'https://r2/inspector-photos/mike.jpg',
        email: 'mike@acme.com',
    },
    inspection: {
        propertyAddress: '1 Main St, Springfield',
        date: '2026-06-15',
        clientName: 'Sarah Buyer',
        agreementRequired: true,
    },
    agreementSnippet: 'This Standard Home Inspection Agreement defines the scope of services to be provided...',
};

describe('ConciergeConfirmPage — A3', () => {
    it('leads with inspector name + photo + property address + date', () => {
        const html = render(ConciergeConfirmPage(BASE));
        expect(html).toContain('Mike Reynolds');
        expect(html).toContain('inspector-photos/mike.jpg');
        expect(html).toContain('1 Main St, Springfield');
        expect(html).toContain('2026-06-15');
    });

    it('renders the agreement snippet preview when agreementRequired', () => {
        const html = render(ConciergeConfirmPage(BASE));
        expect(html).toContain('data-testid="agreement-preview"');
        expect(html).toContain('Standard Home Inspection Agreement');
    });

    it('omits the agreement preview when not required', () => {
        const props: ConciergeConfirmPageProps = {
            ...BASE,
            inspection: { ...BASE.inspection, agreementRequired: false },
        };
        const html = render(ConciergeConfirmPage(props));
        expect(html).not.toContain('data-testid="agreement-preview"');
    });

    it('confirm form POSTs to /api/concierge/confirm with the token', () => {
        const html = render(ConciergeConfirmPage(BASE));
        expect(html).toContain('value="tok-abc-123"');
        expect(html).toContain('/api/concierge/confirm');
    });

    it('falls back to initials placeholder when inspector has no photo', () => {
        const props: ConciergeConfirmPageProps = {
            ...BASE,
            inspector: { name: 'Mike Reynolds', photoUrl: null, email: 'mike@acme.com' },
        };
        const html = render(ConciergeConfirmPage(props));
        expect(html).toContain('MR'); // initials
        expect(html).not.toContain('mike.jpg');
    });

    it('renders a collapsible summary card with mobile testid', () => {
        const html = render(ConciergeConfirmPage(BASE));
        expect(html).toContain('data-testid="summary-card"');
    });
});
