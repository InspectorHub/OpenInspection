import { describe, it, expect } from 'vitest';
import { DashboardPage } from '../../src/templates/pages/dashboard';

/**
 * Agent Accounts A3 — UPCOMING card concierge substate.
 *
 * Frontend-design directive (non-negotiable per plan): do NOT add a 5th stat
 * card. Concierge-pending count appears as a SUBSTATE under the existing
 * UPCOMING card, formatted as "N awaiting your review" in 12px slate text.
 */
function render(node: JSX.Element): string {
    return String(node as unknown as { toString(): string });
}

describe('DashboardPage — UPCOMING concierge substate (A3)', () => {
    it('renders the data-testid hook for the substate so dashboard.js can populate it', () => {
        const html = render(DashboardPage());
        expect(html).toContain('data-testid="upcoming-concierge-substate"');
    });

    it('renders the existing 4-card row, NOT a 5th stat card', () => {
        const html = render(DashboardPage());
        // Sanity: the 4 canonical labels are present
        expect(html).toContain('Upcoming');
        expect(html).toContain('In Progress');
        expect(html).toContain('Needs Attention');
        expect(html).toContain('Recent Reports');
        // Negative: per directive, concierge is a substate, NOT a card label.
        // The string "Concierge review" must not appear as a stat card label.
        expect(html).not.toMatch(/lg:grid-cols-5/);
    });
});
