/**
 * Sprint 3 Track B (S3-4) — Tablet 1024-1279 layout breakpoints.
 *
 * The three-pane editor at 1024-1279 (iPad Pro 11" landscape) currently
 * shows left + middle + cramped right pane. After S3-4, the right pane
 * collapses to an on-demand drawer between 1024 and 1279, restoring its
 * sticky position only at xl (≥1280).
 *
 * These tests rely on the rendered Tailwind class set; they don't probe
 * actual viewport rendering (that's the Playwright snapshot test).
 */
import { describe, it, expect } from 'vitest';
import { InspectionEditPage } from '../../src/templates/pages/inspection-edit';

function render(node: unknown): string {
    return String(node);
}

describe('Sprint 3 S3-4 — inspection-edit tablet breakpoints', () => {
    it('renders the right pane with xl:flex (≥1280) instead of lg:flex (≥1024)', () => {
        const html = render(InspectionEditPage({ inspectionId: 'aaaa', enableRepairList: false }));
        // The persistent (sticky) right pane is gated to xl+. At 1024-1279
        // it stays hidden; the drawer-trigger button + drawer take over.
        // Look for the active-item right aside specifically.
        // The aside has Active Item header + Photos + Quick Comments.
        const rightPaneIdx = html.indexOf('Active Item');
        expect(rightPaneIdx).toBeGreaterThan(-1);

        // Check the surrounding aside class — should have hidden xl:flex
        // (not the prior hidden lg:flex). Search 200 chars before the
        // header for the aside open tag.
        const before = html.slice(Math.max(0, rightPaneIdx - 600), rightPaneIdx);
        expect(before).toMatch(/hidden xl:flex/);
        expect(before).not.toMatch(/hidden lg:flex/);
    });

    it('exposes a tablet-mid drawer trigger (visible only at lg-not-xl)', () => {
        const html = render(InspectionEditPage({ inspectionId: 'aaaa', enableRepairList: false }));
        // The button is a tablet-only affordance. It uses Tailwind's
        // hidden lg:inline-flex xl:hidden compound: hides at mobile +
        // hides at xl+, shows only at the 1024-1279 zone.
        expect(html).toContain('data-testid="tablet-active-item-toggle"');
        const btnIdx = html.indexOf('data-testid="tablet-active-item-toggle"');
        const around = html.slice(Math.max(0, btnIdx - 300), btnIdx + 300);
        expect(around).toMatch(/hidden lg:inline-flex xl:hidden/);
    });

    it('renders the tablet drawer aside with hidden + lg:flex + xl:hidden combo', () => {
        const html = render(InspectionEditPage({ inspectionId: 'aaaa', enableRepairList: false }));
        // The drawer is a separate aside that overlays from the right edge.
        expect(html).toContain('data-testid="tablet-active-item-drawer"');
        const drawerIdx = html.indexOf('data-testid="tablet-active-item-drawer"');
        // The class= attribute lives ahead of the testid (testids appear
        // mid-attribute order); look at the next ~600 chars to find class.
        const around = html.slice(drawerIdx, drawerIdx + 800);
        // Drawer hidden at mobile (<lg) and at xl+ (≥1280) — only in 1024-1279.
        expect(around).toMatch(/lg:flex/);
        expect(around).toMatch(/xl:hidden/);
    });

    /**
     * Snapshot-style structural shape — pin the three breakpoint surfaces
     * so a future layout refactor that accidentally drops one of them
     * trips a clear assertion instead of a Playwright pixel-diff hours
     * later. This is the unit-level analog of a viewport screenshot at
     * mobile / tablet-mid / desktop:
     *
     *   - mobile     surface: x-show="!isDesktop" branch (mobile chip nav)
     *   - tablet-mid surface: tablet-active-item-toggle + drawer (1024-1279)
     *   - desktop    surface: persistent right pane (xl ≥1280)
     */
    it('snapshot — every breakpoint surface present in a single render', () => {
        const html = render(InspectionEditPage({ inspectionId: 'aaaa', enableRepairList: false }));

        // Mobile surface — has the lg:hidden mobile container.
        expect(html).toMatch(/x-show="!isDesktop" class="lg:hidden"/);

        // Tablet-mid surface — toggle button + drawer + backdrop, all
        // gated to the lg-not-xl zone.
        expect(html).toContain('data-testid="tablet-active-item-toggle"');
        expect(html).toContain('data-testid="tablet-active-item-drawer"');
        // The backdrop uses lg:block xl:hidden so the click-outside layer
        // only mounts in the tablet zone.
        expect(html).toMatch(/hidden lg:block xl:hidden/);

        // Desktop surface — the persistent right ACTIVE ITEM pane uses
        // hidden xl:flex (post-S3-4); pre-S3-4 was hidden lg:flex.
        expect(html).toMatch(/hidden xl:flex w-\[280px\]/);
    });
});
