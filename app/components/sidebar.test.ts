import { describe, it, expect } from 'vitest';

describe('Sidebar', () => {
  it('exports Sidebar and MobileHeader', async () => {
    // Basic smoke test that the module loads. Generous timeout: this actually
    // executes the Sidebar module, whose transitive imports are heavy (session
    // context, Stripe, and the full Paraglide message set, which grows with the
    // i18n catalog); under concurrent full-suite load it can exceed the 5s default.
    const mod = await import('~/components/Sidebar');
    expect(mod.Sidebar).toBeDefined();
    expect(mod.MobileHeader).toBeDefined();
  }, 20000);

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
