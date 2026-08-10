import { describe, it, expect } from 'vitest';
import * as SidebarModule from '~/components/Sidebar';
import { WORKSPACE_ITEMS, visibleNavItems } from '~/components/sidebar/nav-items';

/**
 * Why the two real module graphs above are STATIC imports (#88/#95).
 *
 * They used to sit inside `it()` bodies under an explicit `20000` timeout, with
 * a comment saying the graph is heavy and can exceed the 5 s default. The
 * comment was right and the mitigation was not. `~/components/Sidebar` reaches
 * `~/paraglide/messages`, whose generated `_index.js` is ~3.67 MB and which
 * ~441 source files import; Vite transforms it once, on the single main thread
 * every vitest worker shares. So the wait is QUEUEING, and it scales with how
 * busy the suite is rather than with the machine:
 *
 *   solo   (`vitest run app/components/sidebar.test.ts`)      2472 ms
 *   loaded (`vitest run app/components --maxWorkers=16`)     19206 ms
 *
 * A 7.8x swing against a 20000 ms ceiling — 794 ms of headroom, on a laptop, on
 * a suite that is still growing, on a runner that is not CI. A raised timeout
 * never removed the cost; it moved the cliff. It also only ever protected the
 * payer: every other worker queued behind the same transform regardless.
 *
 * ⚠️ THE `beforeAll` HOIST IS NOT ENOUGH FOR THIS PARTICULAR GRAPH, and that is
 * worth knowing before reaching for it elsewhere. `beforeAll`'s budget is
 * separate from `testTimeout` but it is not absent: it is `hookTimeout`, which
 * defaults to 10000 ms. Hoisting these two imports into a `beforeAll` was tried
 * and failed under the same loaded run — "Hook timed out in 10000ms" — because
 * 19 s does not fit in a 10 s budget any more than in a 5 s one. Hoisting
 * relocates a cost; only a static import stops it being ANYONE's deadline,
 * because it is paid during COLLECTION, which has no timeout at all.
 *
 * So the order of preference is: static import; then `beforeAll` when a
 * `vi.doMock` must be installed before the module resolves (which is why the
 * repair-builder specs are dynamic and this one is not); and never a raised
 * timeout of either kind. Nothing here mocks anything, so nothing here has to
 * be dynamic. Placement is enforced by `npm run lint:test-imports`.
 */

describe('Sidebar', () => {
  it('exports Sidebar and MobileHeader', () => {
    // Basic smoke test that the module loads and names what it promises.
    expect(SidebarModule.Sidebar).toBeDefined();
    expect(SidebarModule.MobileHeader).toBeDefined();
  });

  it('WORKSPACE_ITEMS includes Team, not Reports; Library is a single hub entry', async () => {
    // Import the raw module source to verify the nav arrays.
    // We inspect the module text so we don't have to render the component.
    // The nav arrays live in the co-located nav-items module; the Library hub
    // entry is rendered directly in the Sidebar export.
    const navSrc = await import('~/components/sidebar/nav-items?raw');
    const navText = (navSrc as unknown as { default: string }).default;
    const sidebarSrc = await import('~/components/Sidebar?raw');
    const sidebarText = (sidebarSrc as unknown as { default: string }).default;
    const text = navText + sidebarText;
    // #111: the standalone Reports page is retired — its nav item is removed and
    // /reports now 301-redirects to the dashboard Published tab. The sidebar must
    // no longer surface a Reports entry.
    expect(text).not.toContain('"/reports"');
    // Labels are now Paraglide messages (m.nav_item_*), so assert on the route +
    // the externalized message key rather than the raw English literal.
    expect(text).toContain('"/team"');
    expect(text).toContain('nav_item_team');
    // The flat LIBRARY_ITEMS group has been collapsed into a single Library hub
    // entry. The sidebar must point at /library, not the individual module pages.
    expect(text).not.toContain('const LIBRARY_ITEMS');
    expect(text).toContain('"/library"');
    expect(text).not.toContain('"/marketplace"');
    expect(text).not.toContain('"/comments"');
    expect(text).not.toContain('"/repair-items"');
  });

  it('hides Dispatch without scheduleOthers and shows it with the override', () => {
    const dispatchItem = WORKSPACE_ITEMS.find((i) => i.to === '/calendar/dispatch');
    expect(dispatchItem?.capability).toBe('scheduleOthers');

    // An inspector's ROLE default is scheduleOthers: false — and an inspector
    // granted the override is exactly the user this feature was gated for, so
    // the entry must key on the resolved capability rather than the tier.
    const hidden = visibleNavItems(WORKSPACE_ITEMS, { scheduleOthers: false });
    expect(hidden.some((i) => i.to === '/calendar/dispatch')).toBe(false);

    const shown = visibleNavItems(WORKSPACE_ITEMS, { scheduleOthers: true });
    expect(shown.some((i) => i.to === '/calendar/dispatch')).toBe(true);

    // Ungated entries are never filtered out by this.
    expect(hidden.some((i) => i.to === '/inspections')).toBe(true);
  });

  it('fails CLOSED when the session context is missing', () => {
    for (const capabilities of [null, undefined, {}]) {
      const items = visibleNavItems(WORKSPACE_ITEMS, capabilities);
      expect(items.some((i) => i.to === '/calendar/dispatch')).toBe(false);
    }
  });

  it('filters in BOTH nav surfaces, not just the desktop one', async () => {
    // A capability filter applied to one surface only is invisible in review
    // and obvious to the inspector who taps a link that redirects them.
    for (const mod of ['~/components/Sidebar?raw', '~/components/sidebar/MobileDrawer?raw']) {
      const src = await import(/* @vite-ignore */ mod);
      const text = (src as unknown as { default: string }).default;
      expect(text).toContain('visibleNavItems(WORKSPACE_ITEMS');
    }
  });

  it('IA-25: User Menu trigger button is present in Sidebar source', async () => {
    const src = await import('~/components/Sidebar?raw');
    const text = (src as unknown as { default: string }).default;
    // The avatar identity row must expose a data-testid for the trigger
    expect(text).toContain('data-testid="user-menu-trigger"');
    // The UserMenuPopover component must be defined
    expect(text).toContain('UserMenuPopover');
    // aria-haspopup="menu" must be on the trigger
    expect(text).toContain('aria-haspopup="menu"');
  });

  it('IA-25: Log out is reachable from UserMenuPopover (data-testid present)', async () => {
    const src = await import('~/components/sidebar/UserMenuPopover?raw');
    const text = (src as unknown as { default: string }).default;
    // Log out link must be inside the popover with its testid
    expect(text).toContain('data-testid="user-menu-logout"');
    expect(text).toContain('/logout');
  });

  it('IA-25: no standalone bottom theme toggle row in desktop Sidebar footer', async () => {
    const sidebarSrc = await import('~/components/Sidebar?raw');
    const sidebarText = (sidebarSrc as unknown as { default: string }).default;
    // ThemeToggle (old standalone component) must not appear in the Sidebar export.
    // The old component was rendered as <ThemeToggle collapsed={collapsed} />
    // in the Footer section — it must now be gone (moved into the User Menu).
    expect(sidebarText).not.toContain('<ThemeToggle');
    // ThemeSegmentControl (in-menu) must be present instead — it now lives in
    // the co-located UserMenuPopover module.
    const popoverSrc = await import('~/components/sidebar/UserMenuPopover?raw');
    const popoverText = (popoverSrc as unknown as { default: string }).default;
    expect(popoverText).toContain('ThemeSegmentControl');
  });

  it('IA-25: collapse button is an edge handle with correct aria-labels', async () => {
    const src = await import('~/components/Sidebar?raw');
    const text = (src as unknown as { default: string }).default;
    // Edge handle must have both accessible labels — now Paraglide message keys.
    expect(text).toContain('nav_action_collapse_sidebar');
    expect(text).toContain('nav_action_expand_sidebar');
    // The aria-label attribute must be set on the collapse handle button
    expect(text).toContain('aria-label=');
  });

  it('IA-25: popover closes on Escape key (keydown handler present)', async () => {
    const src = await import('~/components/sidebar/UserMenuPopover?raw');
    const text = (src as unknown as { default: string }).default;
    // The UserMenuPopover registers an Escape handler
    expect(text).toContain('"Escape"');
    expect(text).toContain('onClose');
  });

  it('IA-25: MobileDrawer renders menu items flat (no nested popover component)', async () => {
    const src = await import('~/components/sidebar/MobileDrawer?raw');
    const drawerBlock = (src as unknown as { default: string }).default;
    // MobileDrawer should contain the flat Log out link
    expect(drawerBlock).toContain('/logout');
    // MobileDrawer must NOT instantiate UserMenuPopover (no popover on mobile)
    expect(drawerBlock).not.toContain('<UserMenuPopover');
  });
});
