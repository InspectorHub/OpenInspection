import { useState, useRef } from "react";
import { NavLink, useRouteLoaderData } from "react-router";
import { useSessionContext } from "~/hooks/useSessionContext";
import { writeSidebarCookie, type UiPrefs } from "~/lib/ui-prefs";
import { IC, WORKSPACE_ITEMS } from "~/components/sidebar/nav-items";
import { SidebarGroup } from "~/components/sidebar/SidebarGroup";
import { UserMenuPopover } from "~/components/sidebar/UserMenuPopover";
import { MobileHeader } from "~/components/sidebar/MobileHeader";
import { Avatar } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export { MobileHeader };

const STORAGE_KEY = "oi-sidebar-collapsed";

export function Sidebar() {
  // Initial collapsed state comes from the cookie-backed root loader so the
  // server and client first render agree (no hydration mismatch, no post-mount
  // flash from the old two-pass localStorage read).
  const rootPrefs = useRouteLoaderData("root") as UiPrefs | undefined;
  const [collapsed, setCollapsed] = useState(rootPrefs?.sidebarCollapsed ?? false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const ctx = useSessionContext();

  const companyName = ctx?.branding?.companyName || "OpenInspection";
  const logoUrl = ctx?.branding?.logoUrl || "/logo.svg";
  const userName = ctx?.user?.name || "Inspector";
  const userSubline = ctx?.branding?.tenantSlug || "openinspection.dev";
  const userRole = ctx?.user?.role || null;
  const showSwitchWorkspace = ctx?.branding?.isSaas && ctx?.branding?.portalBaseUrl;
  const privacyUrl = ctx?.branding?.privacyUrl ?? null;

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    // Cookie is the SSR source of truth; keep localStorage in sync for legacy reads.
    writeSidebarCookie(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      if (next) {
        document.documentElement.setAttribute("data-sidebar-collapsed", "1");
      } else {
        document.documentElement.removeAttribute("data-sidebar-collapsed");
      }
    } catch {
      // localStorage may be unavailable (private mode); ignore.
    }
  }

  return (
    <aside className="ih-sidebar bg-ih-bg-card border-r border-ih-border hidden lg:flex flex-col sticky top-0 h-screen overflow-hidden">
      {/* Logo + notifications */}
      {/* ds-allow: compact sidebar nav rhythm (7/10/2/14px) — denser than the ih-list/ih-card content scale, no semantic spacing token */}
      <div className={`px-2 pt-1 pb-[14px] flex items-center gap-2.5 border-b border-ih-border shrink-0 ${collapsed ? "justify-center" : ""}`}>
        <img src={logoUrl} alt="" className="w-7 h-7 shrink-0" width={28} height={28} />
        {!collapsed && (
          <>
            <span className="text-[14px] font-bold text-ih-fg-1 tracking-tight leading-tight truncate">{companyName}</span>
            <NavLink to="/notifications" className="ml-auto relative flex items-center justify-center w-7 h-7 rounded-ih-button text-ih-fg-4 hover:bg-ih-bg-muted hover:text-ih-primary transition-all" aria-label={m.nav_action_notifications()}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
            </NavLink>
          </>
        )}
      </div>

      {/* Search trigger */}
      {/* ds-allow: compact sidebar nav rhythm (7/10px), no semantic spacing token */}
      {!collapsed && (
        <div className="px-2 pt-2.5 pb-1">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-[10px] py-[7px] rounded-ih-button bg-ih-bg-muted hover:bg-ih-bg-muted/80 text-ih-fg-4 transition-all border border-ih-border text-[12px]"
            aria-label={m.nav_action_command_palette()}
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M16.5 10.5a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
            <span className="font-medium">{m.nav_action_search()}</span>
            <kbd className="ih-kbd ml-auto">
              {typeof navigator !== "undefined" && navigator.platform?.startsWith("Mac") ? "⌘K" : "Ctrl /"}
            </kbd>
          </button>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-2 py-1 overflow-y-auto">
        <SidebarGroup label={m.nav_section_workspace()} items={WORKSPACE_ITEMS} collapsed={collapsed} />
        {/* ds-allow: compact sidebar nav rhythm (10/7/14px), no semantic spacing token */}
        <div className="mb-[14px]">
          <NavLink
            to="/library"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-[10px] py-[7px] rounded-ih-button text-[13px] font-medium transition-all ${
                isActive ? "bg-ih-primary-tint text-ih-primary font-bold" : "text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary"
              } ${collapsed ? "justify-center" : ""}`
            }
            title={collapsed ? m.nav_item_library() : undefined}
          >
            <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
            {!collapsed && <span>{m.nav_item_library()}</span>}
          </NavLink>
        </div>
      </nav>

      {/* Footer — two rows: Settings + avatar identity row */}
      {/* ds-allow: compact sidebar nav rhythm (2px row gap), no semantic spacing token */}
      <div className="relative mt-auto px-2 py-2.5 border-t border-ih-border space-y-[2px]">
        {/* Collapse handle — slim chevron on the sidebar right edge */}
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? m.nav_action_expand_sidebar() : m.nav_action_collapse_sidebar()}
          className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-10 flex items-center justify-center rounded-r-[6px] bg-ih-bg-card border border-l-0 border-ih-border text-ih-fg-4 opacity-0 hover:opacity-100 focus:opacity-100 group-hover:opacity-100 transition-opacity z-10 hover:text-ih-primary focus:outline-none focus:text-ih-primary"
          title={collapsed ? m.nav_action_expand() : m.nav_action_collapse()}
        >
          {collapsed ? (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          ) : (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          )}
        </button>

        {/* Row 1: Settings */}
        {/* ds-allow: compact sidebar nav rhythm (10/7px), no semantic spacing token */}
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-[10px] py-[7px] rounded-ih-button text-[13px] font-medium transition-all ${
              isActive ? "bg-ih-primary-tint text-ih-primary font-bold" : "text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary"
            } ${collapsed ? "justify-center" : ""}`
          }
          title={collapsed ? m.nav_item_settings() : undefined}
        >
          <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 002.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          {!collapsed && <span>{m.nav_item_settings()}</span>}
        </NavLink>

        {/* Row 2: Avatar identity row — opens User Menu popover */}
        <div className="relative" ref={userMenuRef}>
          <UserMenuPopover
            open={userMenuOpen}
            onClose={() => setUserMenuOpen(false)}
            companyName={companyName}
            tenantSlug={userSubline}
            userRole={userRole}
            showSwitchWorkspace={!!showSwitchWorkspace}
            portalBaseUrl={ctx?.branding?.portalBaseUrl}
            privacyUrl={privacyUrl}
          />
          <button
            type="button"
            data-testid="user-menu-trigger"
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            onClick={() => setUserMenuOpen((v) => !v)}
            className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-ih-button hover:bg-ih-bg-muted transition-all focus:outline-none focus:shadow-ih-focus ${collapsed ? "justify-center" : ""}`}
          >
            {/* Avatar initials circle */}
            <Avatar name={ctx?.user?.name || ""} size={32} variant="self" fallbackIcon="OI" />
            {!collapsed && (
              <>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-[12px] font-bold text-ih-fg-1 truncate">{userName}</div>
                  <div className="text-[10px] text-ih-fg-4 font-[var(--font-ih-mono)] truncate">{userSubline}</div>
                </div>
                {/* Small chevron indicator */}
                <svg
                  className={`w-3 h-3 shrink-0 text-ih-fg-4 transition-transform ${userMenuOpen ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}
