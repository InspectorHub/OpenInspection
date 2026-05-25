import { describe, it, expect } from 'vitest';
import { AgentDashboardPage } from '../../src/templates/pages/agent-dashboard';
import type { AgentReferralRow } from '../../src/services/agent.service';

function render(node: unknown): string {
    if (node && typeof node === 'object' && 'toString' in (node as object)) {
        return (node as { toString(): string }).toString();
    }
    return String(node);
}

const REFS_T1: AgentReferralRow[] = [
    {
        id: 'i-1', tenantId: 't1', tenantName: 'Acme Inspections', tenantSubdomain: 'acme',
        propertyAddress: '1 Main', clientName: 'Sarah', date: '2026-06-01',
        status: 'confirmed', paymentStatus: 'paid', inspectorName: 'Mike',
    },
    {
        id: 'i-2', tenantId: 't1', tenantName: 'Acme Inspections', tenantSubdomain: 'acme',
        propertyAddress: '2 Oak', clientName: 'Bob', date: '2026-06-02',
        status: 'delivered', paymentStatus: 'paid', inspectorName: 'Mike',
    },
];
const REFS_T2: AgentReferralRow[] = [
    {
        id: 'i-3', tenantId: 't2', tenantName: 'BobsInsp', tenantSubdomain: 'bobs',
        propertyAddress: '3 Elm', clientName: 'Tim', date: '2026-06-03',
        status: 'draft', paymentStatus: 'unpaid', inspectorName: 'Bob',
    },
];

describe('AgentDashboardPage — A2', () => {
    it('renders 2 stat cards: active referrals + reports ready to read', () => {
        const html = render(AgentDashboardPage({
            agent: { name: 'Jane Smith', email: 'jane@realty.com' },
            referrals: [...REFS_T1, ...REFS_T2],
            unreadReports: 1,
        }));
        expect(html).toContain('data-testid="agent-stat-active-referrals"');
        expect(html).toContain('data-testid="agent-stat-reports-ready"');
    });

    it('shows total referrals count in active-referrals card', () => {
        const html = render(AgentDashboardPage({
            agent: { name: 'Jane Smith', email: 'jane@realty.com' },
            referrals: [...REFS_T1, ...REFS_T2],
            unreadReports: 1,
        }));
        // Both stats should be present as numbers in the DOM.
        const activeCardMatch = html.match(/data-testid="agent-stat-active-referrals"[\s\S]*?<\/(article|div|section)>/);
        expect(activeCardMatch).not.toBeNull();
        if (activeCardMatch) {
            expect(activeCardMatch[0]).toMatch(/\b3\b/);
        }
    });

    it('groups referrals by tenant with collapsible sections', () => {
        const html = render(AgentDashboardPage({
            agent: { name: 'Jane Smith', email: 'jane@realty.com' },
            referrals: [...REFS_T1, ...REFS_T2],
            unreadReports: 1,
        }));
        expect(html).toContain('data-tenant-section="t1"');
        expect(html).toContain('data-tenant-section="t2"');
        expect(html).toContain('Acme Inspections');
        expect(html).toContain('BobsInsp');
    });

    it('renders lifecycle sparkline for each referral row', () => {
        const html = render(AgentDashboardPage({
            agent: { name: 'Jane Smith', email: 'jane@realty.com' },
            referrals: [...REFS_T1, ...REFS_T2],
            unreadReports: 1,
        }));
        expect(html).toContain('data-testid="referral-sparkline-i-1"');
        expect(html).toContain('data-testid="referral-sparkline-i-2"');
        expect(html).toContain('data-testid="referral-sparkline-i-3"');
    });

    it('lifecycle sparkline marks delivered+paid with both published and paid steps lit', () => {
        const html = render(AgentDashboardPage({
            agent: { name: 'Jane Smith', email: 'jane@realty.com' },
            referrals: [...REFS_T1, ...REFS_T2],
            unreadReports: 1,
        }));
        const sparklineMatch = html.match(/data-testid="referral-sparkline-i-2"[\s\S]*?data-step5-on="(true|false)"/);
        expect(sparklineMatch?.[1]).toBe('true');
        const publishedMatch = html.match(/data-testid="referral-sparkline-i-2"[\s\S]*?data-step4-on="(true|false)"/);
        expect(publishedMatch?.[1]).toBe('true');
    });

    it('lifecycle sparkline for draft+unpaid leaves later steps unlit', () => {
        const html = render(AgentDashboardPage({
            agent: { name: 'Jane Smith', email: 'jane@realty.com' },
            referrals: REFS_T2,
            unreadReports: 0,
        }));
        const step2Match = html.match(/data-testid="referral-sparkline-i-3"[\s\S]*?data-step2-on="(true|false)"/);
        expect(step2Match?.[1]).toBe('false');
        const step5Match = html.match(/data-testid="referral-sparkline-i-3"[\s\S]*?data-step5-on="(true|false)"/);
        expect(step5Match?.[1]).toBe('false');
    });

    it('CTA per delivered row links to read-only report viewer', () => {
        const html = render(AgentDashboardPage({
            agent: { name: 'Jane Smith', email: 'jane@realty.com' },
            referrals: REFS_T1,
            unreadReports: 1,
        }));
        // i-2 is delivered — should have a "View report" link.
        expect(html).toMatch(/href="\/report\/acme\/i-2[^"]*"/);
    });

    it('renders empty-state when referrals array is empty', () => {
        const html = render(AgentDashboardPage({
            agent: { name: 'Jane Smith', email: 'jane@realty.com' },
            referrals: [],
            unreadReports: 0,
        }));
        expect(html).toContain('data-testid="agent-dashboard-empty"');
    });
});
