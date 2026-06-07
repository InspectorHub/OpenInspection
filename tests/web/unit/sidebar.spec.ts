import { describe, it, expect } from 'vitest';

describe('Sidebar', () => {
  it('exports Sidebar and MobileHeader', async () => {
    // Basic smoke test that the module loads
    const mod = await import('~/components/Sidebar');
    expect(mod.Sidebar).toBeDefined();
    expect(mod.MobileHeader).toBeDefined();
  });

  it('WORKSPACE_ITEMS includes Team, not Reports or Marketplace', async () => {
    // Import the raw module source to verify the nav arrays.
    // We inspect the module text so we don't have to render the component.
    const src = await import('~/components/Sidebar?raw');
    const text = (src as unknown as { default: string }).default;
    // #111: the standalone Reports page is retired — its nav item is removed and
    // /reports now 301-redirects to the dashboard Published tab. The sidebar must
    // no longer surface a Reports entry.
    expect(text).not.toContain('"/reports"');
    expect(text).not.toContain('"Reports"');
    expect(text).toContain('"/team"');
    expect(text).toContain('"Team"');
    // Marketplace must not appear in LIBRARY_ITEMS (defensive de-listing).
    // It may still be referenced elsewhere, so we check that the LIBRARY_ITEMS
    // array block does not contain the marketplace entry.
    const libraryBlock = text.slice(
      text.indexOf('const LIBRARY_ITEMS'),
      text.indexOf('function SidebarNavItem'),
    );
    expect(libraryBlock).not.toContain('"/marketplace"');
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
    const src = await import('~/components/Sidebar?raw');
    const text = (src as unknown as { default: string }).default;
    // Log out link must be inside the popover with its testid
    expect(text).toContain('data-testid="user-menu-logout"');
    expect(text).toContain('/logout');
  });

  it('IA-25: no standalone bottom theme toggle row in desktop Sidebar footer', async () => {
    const src = await import('~/components/Sidebar?raw');
    const text = (src as unknown as { default: string }).default;
    // ThemeToggle (old standalone component) must not appear in the Sidebar export.
    // The old component was rendered as <ThemeToggle collapsed={collapsed} />
    // in the Footer section — it must now be gone (moved into the User Menu).
    expect(text).not.toContain('<ThemeToggle');
    // ThemeSegmentControl (in-menu) must be present instead
    expect(text).toContain('ThemeSegmentControl');
  });

  it('IA-25: collapse button is an edge handle with correct aria-labels', async () => {
    const src = await import('~/components/Sidebar?raw');
    const text = (src as unknown as { default: string }).default;
    // Edge handle must have both accessible label strings (may be a JSX ternary expression)
    expect(text).toContain('"Collapse sidebar"');
    expect(text).toContain('"Expand sidebar"');
    // The aria-label attribute must be set on the collapse handle button
    expect(text).toContain('aria-label=');
  });

  it('IA-25: popover closes on Escape key (keydown handler present)', async () => {
    const src = await import('~/components/Sidebar?raw');
    const text = (src as unknown as { default: string }).default;
    // The UserMenuPopover registers an Escape handler
    expect(text).toContain('"Escape"');
    expect(text).toContain('onClose');
  });

  it('IA-25: MobileDrawer renders menu items flat (no nested popover component)', async () => {
    const src = await import('~/components/Sidebar?raw');
    const text = (src as unknown as { default: string }).default;
    // MobileDrawer should contain the flat Log out link
    const drawerBlock = text.slice(
      text.indexOf('function MobileDrawer'),
      text.indexOf('export function MobileHeader'),
    );
    expect(drawerBlock).toContain('/logout');
    // MobileDrawer must NOT instantiate UserMenuPopover (no popover on mobile)
    expect(drawerBlock).not.toContain('<UserMenuPopover');
  });
});
