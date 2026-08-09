import { useState } from "react";
import { useSessionContext } from "~/hooks/useSessionContext";
import { MobileDrawer } from "~/components/sidebar/MobileDrawer";
import { StaffNoticeBell } from "~/components/notices/StaffNoticeBell";
import { m } from "~/paraglide/messages";

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
          {/* Same bell as the desktop sidebar and the other two portals. */}
          <StaffNoticeBell />
          <button onClick={() => setMenuOpen(true)} className="p-2 rounded-ih-button text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary-text transition-colors" aria-label={m.nav_action_open_menu()}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
        </div>
      </div>
      <MobileDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
