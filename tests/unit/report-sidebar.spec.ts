/**
 * Competitor parity Feature C2 — section issue-count badges.
 *
 * Verifies the report viewer left sidebar renders a single combined defect
 * count badge per section (Spectora App.F.2) in addition to the existing
 * per-category breakdown. Anchor links must continue to point to the
 * #section-{id} hash so clicking the section scrolls the report viewer.
 */

import { describe, it, expect } from 'vitest';
import { ReportSidebar, type ReportSidebarSection } from '../../src/templates/components/report-sidebar';

function render(node: unknown): string {
    return String(node);
}

const baseSection = (overrides: Partial<ReportSidebarSection> = {}): ReportSidebarSection => ({
    id:    'roof',
    title: 'Roof',
    defects: { safety: 0, recommendation: 0, maintenance: 0 },
    ...overrides,
});

describe('ReportSidebar — competitor C2 issue-count badges', () => {
    it('renders a combined defect-count badge when section has any defect', () => {
        const html = render(ReportSidebar({
            sections: [baseSection({ defects: { safety: 2, recommendation: 1, maintenance: 0 } })],
            role: 'client', inspectionId: 'i-1', siteName: 'Acme',
        }));
        // Combined badge — total (safety + recommendation + maintenance).
        expect(html).toMatch(/data-test="section-defect-total"[^>]*>3<\/span>/);
    });

    it('omits the combined badge when section has zero defects', () => {
        const html = render(ReportSidebar({
            sections: [baseSection()],
            role: 'client', inspectionId: 'i-1', siteName: 'Acme',
        }));
        expect(html).not.toContain('data-test="section-defect-total"');
    });

    it('renders an anchor link to #section-{id} for each section', () => {
        const html = render(ReportSidebar({
            sections: [baseSection({ id: 'plumbing', title: 'Plumbing' })],
            role: 'client', inspectionId: 'i-1', siteName: 'Acme',
        }));
        expect(html).toContain('href="#section-plumbing"');
    });

    it('keeps the per-category breakdown badges for backwards compat', () => {
        const html = render(ReportSidebar({
            sections: [baseSection({ defects: { safety: 1, recommendation: 0, maintenance: 0 } })],
            role: 'client', inspectionId: 'i-1', siteName: 'Acme',
        }));
        // Existing safety badge (rose-500 background) stays.
        expect(html).toContain('Safety hazards');
    });

    it('uses red (rose) styling on the combined badge', () => {
        const html = render(ReportSidebar({
            sections: [baseSection({ defects: { safety: 0, recommendation: 0, maintenance: 5 } })],
            role: 'client', inspectionId: 'i-1', siteName: 'Acme',
        }));
        // Spec calls for "small red badge" — verify rose color class on the
        // combined badge wrapper.
        expect(html).toMatch(/data-test="section-defect-total"[^>]*class="[^"]*bg-rose-500/);
    });
});
