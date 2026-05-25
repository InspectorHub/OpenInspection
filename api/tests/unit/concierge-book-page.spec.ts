import { describe, it, expect } from 'vitest';
import { ConciergeBookPage, ConciergeBookPageProps } from '../../src/templates/pages/concierge-book';

/**
 * Agent Accounts A3 — Book on Behalf page snapshot.
 *
 * Frontend-design directives (non-negotiable per plan):
 *   1. Persistent top mode-bar in soft-orange — "Booking on behalf of client".
 *   2. After-submit timeline node present in DOM (initially hidden).
 *   3. Form fields: client name, client email, property address.
 */
function render(node: JSX.Element): string {
    return String(node as unknown as { toString(): string });
}

const PROPS: ConciergeBookPageProps = {
    inspector: {
        name: 'Mike Reynolds',
        slug: 'mike',
        contactId: 'c1c2c3c4-1234-4abc-9def-0123456789ab',
    },
    agent: { name: 'Jane Smith' },
    tenantId: 'a4b1c2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    tenantName: 'Acme Inspections',
};

describe('ConciergeBookPage — A3', () => {
    it('renders persistent mode-bar at top', () => {
        const html = render(ConciergeBookPage(PROPS));
        expect(html).toContain('data-testid="mode-bar"');
        expect(html).toMatch(/Booking on behalf/i);
    });

    it('mode-bar mentions agent name and inspector name', () => {
        const html = render(ConciergeBookPage(PROPS));
        expect(html).toContain('Jane Smith');
        expect(html).toContain('Mike Reynolds');
    });

    it('form has client name + email + property address fields', () => {
        const html = render(ConciergeBookPage(PROPS));
        expect(html).toMatch(/name="clientName"/);
        expect(html).toMatch(/name="clientEmail"/);
        expect(html).toMatch(/name="propertyAddress"/);
    });

    it('post-submit timeline structure exists in DOM (initially hidden)', () => {
        const html = render(ConciergeBookPage(PROPS));
        expect(html).toContain('data-testid="post-submit-timeline"');
        // Should be hidden by default (style or hidden attribute or x-show)
        expect(html).toMatch(/data-testid="post-submit-timeline"[\s\S]{0,400}(style="display:\s*none|hidden)/);
    });

    it('timeline includes the four canonical steps', () => {
        const html = render(ConciergeBookPage(PROPS));
        // The four steps per the plan: Submitted -> Client confirms -> Agreement signed -> Inspection scheduled.
        expect(html).toMatch(/Submitted|submitted/);
        expect(html).toMatch(/Client confirms|client confirm/i);
        expect(html).toMatch(/Agreement|agreement/);
        expect(html).toMatch(/scheduled/i);
    });

    it('mode-bar uses soft-orange styling per directive', () => {
        const html = render(ConciergeBookPage(PROPS));
        // Soft-orange directive — accept any of the canonical orange tokens.
        expect(html).toMatch(/#fff4e6|#fff7ed|#ffedd5|F55A1A/);
    });
});
