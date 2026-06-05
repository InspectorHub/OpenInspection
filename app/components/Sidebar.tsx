import { useState, useEffect, useRef } from "react";
import { NavLink, useRouteLoaderData } from "react-router";
import { useTheme } from "~/hooks/useTheme";
import { useSessionContext } from "~/hooks/useSessionContext";
import { writeSidebarCookie, type UiPrefs } from "~/lib/ui-prefs";

const STORAGE_KEY = "oi-sidebar-collapsed";

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
}

const IC = "w-4 h-4 shrink-0";

const WORKSPACE_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Inspections", icon: <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg> },
  { to: "/reports", label: "Reports", icon: <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg> },
  { to: "/calendar", label: "Calendar", icon: <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg> },
  { to: "/contacts", label: "Contacts", icon: <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg> },
  { to: "/invoices", label: "Invoices", icon: <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg> },
  { to: "/metrics", label: "Metrics", icon: <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg> },
  { to: "/team", label: "Team", icon: <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg> },
];

const LIBRARY_ITEMS: NavItem[] = [
  { to: "/templates", label: "Templates", icon: <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg> },
  { to: "/comments", label: "Canned Comments", icon: <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg> },
  { to: "/repair-items", label: "Repair Items", icon: <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
  { to: "/library/tags", label: "Tags", icon: <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg> },
  { to: "/agreements", label: "Agreements", icon: <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg> },
  { to: "/library/rating-systems", label: "Rating Systems", icon: <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg> },
];

function SidebarNavItem({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-[10px] py-[7px] rounded-[6px] text-[13px] font-medium transition-all ${
          isActive
            ? "bg-ih-primary-tint text-ih-primary font-bold"
            : "text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary"
        } ${collapsed ? "justify-center" : ""}`
      }
      title={collapsed ? item.label : undefined}
    >
      {item.icon}
      {!collapsed && <span>{item.label}</span>}
    </NavLink>
  );
}

function SidebarGroup({ label, items, collapsed }: { label: string; items: NavItem[]; collapsed: boolean }) {
  return (
    <div className="mb-[14px]">
      {!collapsed && (
        <div className="ih-eyebrow px-[10px] mb-[10px]">{label}</div>
      )}
      <div className="flex flex-col gap-[2px]">
        {items.map((item) => (
          <SidebarNavItem key={item.to} item={item} collapsed={collapsed} />
        ))}
      </div>
    </div>
  );
}

// ─── Inline 3-segment theme control used inside the User Menu ─────────────────
function ThemeSegmentControl() {
  const { scheme, setColorScheme } = useTheme();
  return (
    <div className="flex gap-1 p-1 bg-ih-bg-muted rounded-[6px]">
      {(["auto", "light", "dark"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => setColorScheme(mode)}
          className={`flex-1 py-1 rounded-[4px] text-[11px] font-bold capitalize transition-colors focus:outline-none focus:shadow-ih-focus ${
            scheme === mode
              ? "bg-ih-bg-card text-ih-primary shadow-ih-card"
              : "text-ih-fg-3 hover:text-ih-fg-1"
          }`}
          aria-pressed={scheme === mode}
        >
          {mode === "auto" ? "Auto" : mode === "light" ? "Light" : "Dark"}
        </button>
      ))}
    </div>
  );
}

// ─── User Menu popover (desktop sidebar) ─────────────────────────────────────
interface UserMenuPopoverProps {
  open: boolean;
  onClose: () => void;
  siteName: string;
  tenantSlug: string;
  userRole?: string | null;
  showSwitchWorkspace: boolean;
  portalBaseUrl?: string | null;
  privacyUrl?: string | null;
}

function UserMenuPopover({
  open,
  onClose,
  siteName,
  tenantSlug,
  userRole,
  showSwitchWorkspace,
  portalBaseUrl,
  privacyUrl,
}: UserMenuPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="User menu"
      className="absolute bottom-full left-0 mb-2 w-[220px] bg-ih-bg-card border border-ih-border rounded-lg shadow-ih-popover z-50 py-1.5 overflow-hidden"
    >
      {/* Workspace card */}
      <div className="px-3 py-2 mb-0.5">
        <div className="text-[12px] font-bold text-ih-fg-1 truncate">{siteName}</div>
        <div className="text-[10px] font-[var(--font-ih-mono)] text-ih-fg-4 truncate">{tenantSlug}</div>
        {userRole && (
          <div className="text-[10px] text-ih-fg-3 capitalize mt-0.5">{userRole}</div>
        )}
      </div>

      {/* Switch workspace — SaaS only */}
      {showSwitchWorkspace && portalBaseUrl && (
        <a
          href={`${portalBaseUrl}/workspace/switch`}
          role="menuitem"
          className="flex items-center gap-2 px-3 py-[7px] text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary transition-colors focus:outline-none focus:bg-ih-bg-muted"
          onClick={onClose}
        >
          <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
          <span>Switch workspace…</span>
        </a>
      )}

      {/* Divider + Theme */}
      <div className="border-t border-ih-border my-1" />
      <div className="px-3 py-1.5">
        <div className="text-[10px] font-bold text-ih-fg-4 uppercase tracking-wide mb-1.5">Theme</div>
        <ThemeSegmentControl />
      </div>

      {/* Divider + Account items */}
      <div className="border-t border-ih-border my-1" />
      <NavLink
        to="/settings/profile"
        role="menuitem"
        className={({ isActive }) =>
          `flex items-center gap-2 px-3 py-[7px] text-[13px] font-medium transition-colors focus:outline-none focus:bg-ih-bg-muted ${
            isActive ? "text-ih-primary bg-ih-primary-tint" : "text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary"
          }`
        }
        onClick={onClose}
      >
        <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
        <span>My profile</span>
      </NavLink>

      {privacyUrl && (
        <a
          href={privacyUrl}
          target="_blank"
          rel="noreferrer"
          role="menuitem"
          className="flex items-center gap-2 px-3 py-[7px] text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary transition-colors focus:outline-none focus:bg-ih-bg-muted"
          onClick={onClose}
        >
          <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          <span>Privacy Policy</span>
        </a>
      )}

      <a
        href="/logout"
        role="menuitem"
        data-testid="user-menu-logout"
        className="flex items-center gap-2 px-3 py-[7px] text-[13px] font-medium text-ih-bad-fg hover:bg-ih-bad-bg transition-colors focus:outline-none focus:bg-ih-bad-bg"
        onClick={onClose}
      >
        <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
        <span>Log out</span>
      </a>
    </div>
  );
}

// ─── Mobile drawer ─────────────────────────────────────────────────────────────
function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { scheme, setColorScheme } = useTheme();
  const ctx = useSessionContext();

  const siteName = ctx?.branding?.siteName || "OpenInspection";
  const logoUrl = ctx?.branding?.logoUrl || "/logo.svg";
  const tenantSlug = ctx?.branding?.tenantSlug || "openinspection.dev";
  const userName = ctx?.user?.name || "Inspector";
  const userRole = ctx?.user?.role || null;
  const showSwitchWorkspace = ctx?.branding?.isSaas && ctx?.branding?.portalBaseUrl;
  const privacyUrl = ctx?.branding?.privacyUrl ?? null;

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-[rgba(15,23,42,0.55)] backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-80 max-w-[85vw] h-full bg-ih-bg-card shadow-ih-popover flex flex-col">
        <div className="p-4 flex items-center justify-between border-b border-ih-border">
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="" className="w-7 h-7 shrink-0" width={28} height={28} />
            <span className="text-sm font-bold text-ih-fg-1 tracking-tight">{siteName}</span>
          </div>
          <button onClick={onClose} className="p-2 rounded-[6px] text-ih-fg-4 hover:bg-ih-bg-muted hover:text-ih-fg-2 transition-colors" aria-label="Close menu">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <nav className="flex-1 p-3 overflow-y-auto space-y-3">
          <div>
            <div className="ih-eyebrow px-3 pt-3 pb-[10px]">Workspace</div>
            <div className="flex flex-col gap-[2px]">
              {WORKSPACE_ITEMS.map((item) => (
                <NavLink key={item.to} to={item.to} onClick={onClose} className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-[6px] text-[13px] font-medium transition-all ${isActive ? "bg-ih-primary-tint text-ih-primary font-bold" : "text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary"}`}>
                  {item.icon}
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
          <div>
            <div className="ih-eyebrow px-3 pt-1 pb-[10px]">Library</div>
            <div className="flex flex-col gap-[2px]">
              {LIBRARY_ITEMS.map((item) => (
                <NavLink key={item.to} to={item.to} onClick={onClose} className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-[6px] text-[13px] font-medium transition-all ${isActive ? "bg-ih-primary-tint text-ih-primary font-bold" : "text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary"}`}>
                  {item.icon}
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>

          {/* Bottom section — flat (no popover on mobile) */}
          <div className="pt-3 mt-1 border-t border-ih-border">
            {/* Workspace identity card */}
            <div className="px-3 py-2 mb-1 rounded-[6px] bg-ih-bg-muted/60">
              <div className="text-[11px] font-bold text-ih-fg-1 truncate">{siteName}</div>
              <div className="text-[10px] font-[var(--font-ih-mono)] text-ih-fg-4 truncate">{tenantSlug}</div>
              {userRole && <div className="text-[10px] text-ih-fg-3 capitalize">{userRole}</div>}
            </div>

            <NavLink to="/settings" onClick={onClose} className="flex items-center gap-3 px-3 py-2 rounded-[6px] text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary transition-all">
              <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 002.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              <span>Settings</span>
            </NavLink>

            <NavLink to="/settings/profile" onClick={onClose} className="flex items-center gap-3 px-3 py-2 rounded-[6px] text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary transition-all">
              <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
              <span>My profile</span>
            </NavLink>

            {showSwitchWorkspace && ctx?.branding?.portalBaseUrl && (
              <a href={`${ctx.branding.portalBaseUrl}/workspace/switch`} onClick={onClose} className="flex items-center gap-3 px-3 py-2 rounded-[6px] text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary transition-all">
                <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                <span>Switch workspace…</span>
              </a>
            )}

            {privacyUrl && (
              <a href={privacyUrl} target="_blank" rel="noreferrer" onClick={onClose} className="flex items-center gap-3 px-3 py-2 rounded-[6px] text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary transition-all">
                <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                <span>Privacy Policy</span>
              </a>
            )}
          </div>
        </nav>

        {/* Mobile bottom: theme control + name + log out */}
        <div className="p-3 border-t border-ih-border bg-ih-bg-muted/50 space-y-1">
          <div className="px-1 py-0.5">
            <div className="text-[10px] font-bold text-ih-fg-4 uppercase tracking-wide mb-1.5 px-1">Theme</div>
            <div className="flex gap-1">
              {(["auto", "light", "dark"] as const).map((mode) => (
                <button key={mode} onClick={() => setColorScheme(mode)} className={`flex-1 py-1.5 rounded-[6px] text-[11px] font-bold transition-colors ${scheme === mode ? "bg-ih-primary-tint text-ih-primary" : "text-ih-fg-3 hover:bg-ih-bg-muted"}`}>
                  {mode === "auto" ? "Auto" : mode === "dark" ? "Dark" : "Light"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2.5 px-2 py-1">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-ih-primary to-ih-primary-700 flex items-center justify-center text-ih-fg-inverse text-[11px] font-bold shrink-0">
              {ctx?.user?.initials || "OI"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-bold text-ih-fg-1 truncate">{userName}</div>
            </div>
          </div>
          <a href="/logout" className="w-full flex items-center gap-3 px-3 py-2 rounded-[6px] text-ih-bad-fg hover:bg-ih-bad-bg transition-all font-medium text-[13px]">
            <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            <span>Log out</span>
          </a>
        </div>
      </div>
    </div>
  );
}

export function MobileHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const ctx = useSessionContext();

  const siteName = ctx?.branding?.siteName || "OpenInspection";
  const logoUrl = ctx?.branding?.logoUrl || "/logo.svg";

  return (
    <>
      <div className="lg:hidden sticky top-0 z-40 bg-ih-bg-card border-b border-ih-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={logoUrl} alt="" className="w-8 h-8 shrink-0" width={32} height={32} />
          <span className="text-lg font-extrabold text-ih-fg-1 tracking-tight">{siteName}</span>
        </div>
        <div className="flex items-center gap-1">
          <NavLink to="/notifications" className="relative flex items-center justify-center w-10 h-10 rounded-[6px] text-ih-fg-3 hover:bg-ih-bg-muted hover:text-ih-primary transition-all" aria-label="Notifications">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
          </NavLink>
          <button onClick={() => setMenuOpen(true)} className="p-2 rounded-[6px] text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary transition-colors" aria-label="Open menu">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
        </div>
      </div>
      <MobileDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}

export function Sidebar() {
  // Initial collapsed state comes from the cookie-backed root loader so the
  // server and client first render agree (no hydration mismatch, no post-mount
  // flash from the old two-pass localStorage read).
  const rootPrefs = useRouteLoaderData("root") as UiPrefs | undefined;
  const [collapsed, setCollapsed] = useState(rootPrefs?.sidebarCollapsed ?? false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const ctx = useSessionContext();

  const siteName = ctx?.branding?.siteName || "OpenInspection";
  const logoUrl = ctx?.branding?.logoUrl || "/logo.svg";
  const userName = ctx?.user?.name || "Inspector";
  const userSubline = ctx?.branding?.tenantSlug || "openinspection.dev";
  const userInitials = ctx?.user?.initials || "OI";
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
      <div className={`px-2 pt-1 pb-[14px] flex items-center gap-2.5 border-b border-ih-border shrink-0 ${collapsed ? "justify-center" : ""}`}>
        <img src={logoUrl} alt="" className="w-7 h-7 shrink-0" width={28} height={28} />
        {!collapsed && (
          <>
            <span className="text-[14px] font-bold text-ih-fg-1 tracking-tight leading-tight truncate">{siteName}</span>
            <NavLink to="/notifications" className="ml-auto relative flex items-center justify-center w-7 h-7 rounded-[6px] text-ih-fg-4 hover:bg-ih-bg-muted hover:text-ih-primary transition-all" aria-label="Notifications">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
            </NavLink>
          </>
        )}
      </div>

      {/* Search trigger */}
      {!collapsed && (
        <div className="px-2 pt-2.5 pb-1">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-[10px] py-[7px] rounded-[6px] bg-ih-bg-muted hover:bg-ih-bg-muted/80 text-ih-fg-4 transition-all border border-ih-border text-[12px]"
            aria-label="Open command palette"
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M16.5 10.5a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
            <span className="font-medium">Search…</span>
            <kbd className="ih-kbd ml-auto">
              {typeof navigator !== "undefined" && navigator.platform?.startsWith("Mac") ? "⌘K" : "Ctrl /"}
            </kbd>
          </button>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-2 py-1 overflow-y-auto">
        <SidebarGroup label="Workspace" items={WORKSPACE_ITEMS} collapsed={collapsed} />
        <SidebarGroup label="Library" items={LIBRARY_ITEMS} collapsed={collapsed} />
      </nav>

      {/* Footer — two rows: Settings + avatar identity row */}
      <div className="relative mt-auto px-2 py-2.5 border-t border-ih-border space-y-[2px]">
        {/* Collapse handle — slim chevron on the sidebar right edge */}
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-10 flex items-center justify-center rounded-r-[6px] bg-ih-bg-card border border-l-0 border-ih-border text-ih-fg-4 opacity-0 hover:opacity-100 focus:opacity-100 group-hover:opacity-100 transition-opacity z-10 hover:text-ih-primary focus:outline-none focus:text-ih-primary"
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          ) : (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          )}
        </button>

        {/* Row 1: Settings */}
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-[10px] py-[7px] rounded-[6px] text-[13px] font-medium transition-all ${
              isActive ? "bg-ih-primary-tint text-ih-primary font-bold" : "text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary"
            } ${collapsed ? "justify-center" : ""}`
          }
          title={collapsed ? "Settings" : undefined}
        >
          <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 002.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          {!collapsed && <span>Settings</span>}
        </NavLink>

        {/* Row 2: Avatar identity row — opens User Menu popover */}
        <div className="relative" ref={userMenuRef}>
          <UserMenuPopover
            open={userMenuOpen}
            onClose={() => setUserMenuOpen(false)}
            siteName={siteName}
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
            className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-[6px] hover:bg-ih-bg-muted transition-all focus:outline-none focus:shadow-ih-focus ${collapsed ? "justify-center" : ""}`}
          >
            {/* Avatar initials circle */}
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-ih-primary to-ih-primary-700 flex items-center justify-center text-ih-fg-inverse text-[12px] font-bold shrink-0">
              {userInitials}
            </div>
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
