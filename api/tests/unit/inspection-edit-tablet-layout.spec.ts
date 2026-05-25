/**
 * Gap 2 — Editor 4-column layout verification.
 *
 * Replaced the Sprint 3 S3-4 tablet breakpoint tests. The old layout had:
 *   - xl-only right pane (hidden xl:flex)
 *   - tablet drawer (lg:flex xl:hidden)
 *   - tablet toggle button
 *
 * The new layout uses a persistent SideRail component at all desktop widths,
 * eliminating the tablet-specific drawer. These tests verify the 4-column
 * layout structure and SideRail presence.
 */
import { describe, it, expect } from 'vitest';
import { InspectionEditPage } from '../../src/templates/pages/inspection-edit';

function render(node: unknown): string {
    return String(node);
}

describe('Gap 2 — editor 4-column layout', () => {
    it('renders the SideRail component', () => {
        const html = render(InspectionEditPage({ inspectionId: 'aaaa', enableRepairList: false }));
        expect(html).toContain('sideRailMode');
        expect(html).toContain('sideRailOpen');
    });

    it('no longer renders the tablet drawer or toggle', () => {
        const html = render(InspectionEditPage({ inspectionId: 'aaaa', enableRepairList: false }));
        expect(html).not.toContain('data-testid="tablet-active-item-drawer"');
        expect(html).not.toContain('data-testid="tablet-active-item-toggle"');
    });

    it('left sidebar is 200px wide', () => {
        const html = render(InspectionEditPage({ inspectionId: 'aaaa', enableRepairList: false }));
        expect(html).toContain('w-[200px]');
    });

    it('center column has focal indigo top border', () => {
        const html = render(InspectionEditPage({ inspectionId: 'aaaa', enableRepairList: false }));
        expect(html).toContain('border-t-2 border-indigo-600');
    });

    it('item list uses flex-col (not grid)', () => {
        const html = render(InspectionEditPage({ inspectionId: 'aaaa', enableRepairList: false }));
        expect(html).not.toMatch(/grid grid-cols-2 xl:grid-cols-3/);
    });

    it('mobile surface still present', () => {
        const html = render(InspectionEditPage({ inspectionId: 'aaaa', enableRepairList: false }));
        expect(html).toMatch(/x-show="!isDesktop"/);
    });
});
