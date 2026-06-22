import { useState } from "react";
import { NavLink } from "react-router";
import { useSessionContext } from "~/hooks/useSessionContext";
import { MobileDrawer } from "~/components/sidebar/MobileDrawer";

export function MobileHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const ctx = useSessionContext();

  const companyName = ctx?.branding?.companyName || "OpenInspection";
  const logoUrl = ctx?.branding?.logoUrl || "/logo.svg";

  return (
    <>
      <div className="lg:hidden sticky top-0 z-40 bg-ih-bg-card border-b border-ih-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={logoUrl} alt="" className="w-8 h-8 shrink-0" width={32} height={32} />
          <span className="text-lg font-extrabold text-ih-fg-1 tracking-tight">{companyName}</span>
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
