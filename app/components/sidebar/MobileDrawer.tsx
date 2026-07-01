import { NavLink } from "react-router";
import { useTheme } from "~/hooks/useTheme";
import { useSessionContext } from "~/hooks/useSessionContext";
import { IC, WORKSPACE_ITEMS } from "~/components/sidebar/nav-items";

// ─── Mobile drawer ─────────────────────────────────────────────────────────────
export function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { scheme, setColorScheme } = useTheme();
  const ctx = useSessionContext();

  const companyName = ctx?.branding?.companyName || "OpenInspection";
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
            <span className="text-sm font-bold text-ih-fg-1 tracking-tight">{companyName}</span>
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
            <div className="flex flex-col gap-[2px]">
              <NavLink to="/library" onClick={onClose} className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-[6px] text-[13px] font-medium transition-all ${isActive ? "bg-ih-primary-tint text-ih-primary font-bold" : "text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary"}`}>
                <svg className={IC} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                <span>Library</span>
              </NavLink>
            </div>
          </div>

          {/* Bottom section — flat (no popover on mobile) */}
          <div className="pt-3 mt-1 border-t border-ih-border">
            {/* Workspace identity card */}
            <div className="px-3 py-2 mb-1 rounded-[6px] bg-ih-bg-muted/60">
              <div className="text-[11px] font-bold text-ih-fg-1 truncate">{companyName}</div>
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
              <a href={`${ctx.branding.portalBaseUrl}/company/switch`} onClick={onClose} className="flex items-center gap-3 px-3 py-2 rounded-[6px] text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary transition-all">
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
              {(["auto", "light", "dark", "field"] as const).map((mode) => (
                <button key={mode} onClick={() => setColorScheme(mode)} className={`flex-1 py-1.5 rounded-[6px] text-[11px] font-bold transition-colors ${scheme === mode ? "bg-ih-primary-tint text-ih-primary" : "text-ih-fg-3 hover:bg-ih-bg-muted"}`}>
                  {mode === "auto" ? "Auto" : mode === "dark" ? "Dark" : mode === "field" ? "Field" : "Light"}
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
