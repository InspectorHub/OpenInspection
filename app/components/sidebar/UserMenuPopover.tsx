import { useEffect, useRef } from "react";
import { NavLink } from "react-router";
import { IC } from "~/components/sidebar/nav-items";
import { ThemeSegmentControl } from "~/components/sidebar/ThemeSegmentControl";

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

export function UserMenuPopover({
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
