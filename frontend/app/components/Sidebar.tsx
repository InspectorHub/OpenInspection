import { useState, useEffect, useRef } from "react";
import { NavLink, useNavigate } from "react-router";
import { useTheme } from "~/hooks/useTheme";

const STORAGE_KEY = "oi-sidebar-collapsed";

function getInitialCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
}

const ICON_CLASS = "w-4 h-4 shrink-0";

function InspectionsIcon() {
  return <svg className={ICON_CLASS} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>;
}
function CalendarIcon() {
  return <svg className={ICON_CLASS} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
}
function ContactsIcon() {
  return <svg className={ICON_CLASS} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
}
function InvoicesIcon() {
  return <svg className={ICON_CLASS} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>;
}
function MetricsIcon() {
  return <svg className={ICON_CLASS} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>;
}
function TemplatesIcon() {
  return <svg className={ICON_CLASS} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
}
function MarketplaceIcon() {
  return <svg className={ICON_CLASS} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" /></svg>;
}
function CommentsIcon() {
  return <svg className={ICON_CLASS} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>;
}
function RepairItemsIcon() {
  return <svg className={ICON_CLASS} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
}
function TagsIcon() {
  return <svg className={ICON_CLASS} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>;
}
function AgreementsIcon() {
  return <svg className={ICON_CLASS} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
}
function RatingSystemsIcon() {
  return <svg className={ICON_CLASS} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>;
}
function SettingsIcon() {
  return <svg className={ICON_CLASS} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 002.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
}
function SearchIcon() {
  return <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M16.5 10.5a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>;
}
function NotificationIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>;
}

const WORKSPACE_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Inspections", icon: <InspectionsIcon /> },
  { to: "/calendar", label: "Calendar", icon: <CalendarIcon /> },
  { to: "/contacts", label: "Contacts", icon: <ContactsIcon /> },
  { to: "/invoices", label: "Invoices", icon: <InvoicesIcon /> },
  { to: "/metrics", label: "Metrics", icon: <MetricsIcon /> },
];

const LIBRARY_ITEMS: NavItem[] = [
  { to: "/templates", label: "Templates", icon: <TemplatesIcon /> },
  { to: "/marketplace", label: "Marketplace", icon: <MarketplaceIcon /> },
  { to: "/comments", label: "Comments", icon: <CommentsIcon /> },
  { to: "/recommendations", label: "Repair Items", icon: <RepairItemsIcon /> },
  { to: "/library/tags", label: "Tags", icon: <TagsIcon /> },
  { to: "/agreements", label: "Agreements", icon: <AgreementsIcon /> },
  { to: "/library/rating-systems", label: "Rating Systems", icon: <RatingSystemsIcon /> },
];

function SidebarNavItem({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[13px] font-medium transition-all ${
          isActive
            ? "bg-indigo-50 text-indigo-600 dark:bg-slate-700 dark:text-white"
            : "text-slate-600 hover:bg-slate-50 hover:text-indigo-600 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-indigo-400"
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
    <div>
      {!collapsed && (
        <div className="ih-eyebrow px-2.5 pt-2 pb-1.5 text-[10px] font-extrabold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">
          {label}
        </div>
      )}
      <div className="flex flex-col gap-0.5">
        {items.map((item) => (
          <SidebarNavItem key={item.to} item={item} collapsed={collapsed} />
        ))}
      </div>
    </div>
  );
}

function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const { scheme, setColorScheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const label = scheme === "auto" ? "Auto" : scheme === "dark" ? "Dark" : "Light";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all"
        title={collapsed ? `Theme: ${label}` : "Color scheme"}
      >
        {scheme === "dark" ? (
          <svg className={ICON_CLASS} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
        ) : scheme === "light" ? (
          <svg className={ICON_CLASS} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
        ) : (
          <svg className={ICON_CLASS} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
        )}
        {!collapsed && <span className="flex-1 text-left">{label}</span>}
        {!collapsed && (
          <svg className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        )}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 py-1 overflow-hidden">
          {(["auto", "dark", "light"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => { setColorScheme(mode); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
              <span className="flex-1 text-left capitalize">{mode}</span>
              {scheme === mode && (
                <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { scheme, setColorScheme } = useTheme();

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-80 max-w-[85vw] h-full bg-white dark:bg-slate-900 shadow-2xl flex flex-col">
        <div className="p-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="" className="w-7 h-7 shrink-0" />
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100 tracking-tight">OpenInspection</span>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600 dark:hover:text-slate-300 transition-colors" aria-label="Close menu">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <nav className="flex-1 p-3 overflow-y-auto space-y-3">
          <div>
            <div className="px-3 pt-3 pb-1.5 text-[10px] font-extrabold uppercase tracking-[0.15em] text-slate-400">Workspace</div>
            <div className="flex flex-col gap-0.5">
              {WORKSPACE_ITEMS.map((item) => (
                <NavLink key={item.to} to={item.to} onClick={onClose} className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-all ${isActive ? "bg-indigo-50 text-indigo-600 dark:bg-slate-700 dark:text-white" : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400"}`}>
                  {item.icon}
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
          <div>
            <div className="px-3 pt-1 pb-1.5 text-[10px] font-extrabold uppercase tracking-[0.15em] text-slate-400">Library</div>
            <div className="flex flex-col gap-0.5">
              {LIBRARY_ITEMS.map((item) => (
                <NavLink key={item.to} to={item.to} onClick={onClose} className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-all ${isActive ? "bg-indigo-50 text-indigo-600 dark:bg-slate-700 dark:text-white" : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400"}`}>
                  {item.icon}
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
          <div className="pt-3 mt-1 border-t border-slate-100 dark:border-slate-700">
            <NavLink to="/settings" onClick={onClose} className="flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all">
              <SettingsIcon />
              <span>Settings</span>
            </NavLink>
          </div>
        </nav>
        <div className="p-3 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/20 space-y-1">
          <div className="flex gap-1">
            {(["auto", "light", "dark"] as const).map((mode) => (
              <button key={mode} onClick={() => setColorScheme(mode)} className={`flex-1 py-1.5 rounded-md text-[11px] font-bold transition-colors ${scheme === mode ? "bg-indigo-50 text-indigo-600 dark:bg-slate-700 dark:text-indigo-400" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700/50"}`}>
                {mode === "auto" ? "Auto" : mode === "dark" ? "Dark" : "Light"}
              </button>
            ))}
          </div>
          <a href="/logout" className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all font-medium text-[13px]">
            <svg className={ICON_CLASS} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            <span>Sign Out</span>
          </a>
        </div>
      </div>
    </div>
  );
}

export function MobileHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <>
      <div className="lg:hidden sticky top-0 z-40 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="" className="w-8 h-8 shrink-0" />
          <span className="text-lg font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">OpenInspection</span>
        </div>
        <div className="flex items-center gap-1">
          <NavLink to="/notifications" className="relative flex items-center justify-center w-10 h-10 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-indigo-600 transition-all" aria-label="Notifications">
            <NotificationIcon />
          </NavLink>
          <button onClick={() => setMenuOpen(true)} className="p-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-indigo-600 transition-colors" aria-label="Open menu">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
        </div>
      </div>
      <MobileDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(getInitialCollapsed());
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      if (next) {
        document.documentElement.setAttribute("data-sidebar-collapsed", "1");
      } else {
        document.documentElement.removeAttribute("data-sidebar-collapsed");
      }
    } catch {}
  }

  return (
    <aside
      className={`ih-sidebar bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 hidden lg:flex flex-col sticky top-0 h-screen overflow-hidden transition-[width] duration-200 ${
        collapsed ? "w-14" : "w-60"
      }`}
    >
      <div className={`px-3 pt-3 pb-2 flex items-center gap-2.5 border-b border-slate-100 dark:border-slate-700 shrink-0 ${collapsed ? "justify-center" : ""}`}>
        <img src="/logo.svg" alt="" className="w-7 h-7 shrink-0" />
        {!collapsed && (
          <>
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100 tracking-tight leading-tight truncate">OpenInspection</span>
            <NavLink to="/notifications" className="ml-auto relative flex items-center justify-center w-7 h-7 rounded-md text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-indigo-600 transition-all" aria-label="Notifications">
              <NotificationIcon />
            </NavLink>
          </>
        )}
      </div>

      {!collapsed && (
        <div className="px-2.5 pt-2.5 pb-1">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-2.5 py-[7px] rounded-md bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 dark:text-slate-500 transition-all border border-slate-200/60 dark:border-slate-700/60 text-[12px]"
            aria-label="Open command palette"
          >
            <SearchIcon />
            <span className="font-medium">Search…</span>
            <kbd className="ml-auto px-1 py-0.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded text-[10px] font-mono text-slate-400 dark:text-slate-500">
              {typeof navigator !== "undefined" && navigator.platform?.startsWith("Mac") ? "⌘K" : "Ctrl /"}
            </kbd>
          </button>
        </div>
      )}

      <nav className="flex-1 px-2.5 py-1 overflow-y-auto space-y-3">
        <SidebarGroup label="Workspace" items={WORKSPACE_ITEMS} collapsed={collapsed} />
        <SidebarGroup label="Library" items={LIBRARY_ITEMS} collapsed={collapsed} />
      </nav>

      <div className="mt-auto px-2.5 py-2.5 border-t border-slate-100 dark:border-slate-700 space-y-0.5">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[13px] font-medium transition-all ${
              isActive
                ? "bg-indigo-50 text-indigo-600 dark:bg-slate-700 dark:text-white"
                : "text-slate-600 hover:bg-slate-50 hover:text-indigo-600 dark:text-slate-300 dark:hover:bg-slate-700/50 dark:hover:text-indigo-400"
            } ${collapsed ? "justify-center" : ""}`
          }
          title={collapsed ? "Settings" : undefined}
        >
          <SettingsIcon />
          {!collapsed && <span>Settings</span>}
        </NavLink>

        <ThemeToggle collapsed={collapsed} />

        <button
          onClick={toggleCollapsed}
          className={`flex items-center gap-2 px-2.5 py-[6px] mt-1 rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 text-[11px] font-bold transition-all w-full ${collapsed ? "justify-center" : ""}`}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? (
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2" /><line x1="15" y1="3" x2="15" y2="21" strokeWidth="2" /><polyline points="7 9 10 12 7 15" strokeWidth="2" /></svg>
          ) : (
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2" /><line x1="15" y1="3" x2="15" y2="21" strokeWidth="2" /><polyline points="10 9 7 12 10 15" strokeWidth="2" /></svg>
          )}
          {!collapsed && <span>Collapse</span>}
        </button>

        <div className={`flex items-center gap-2.5 px-2 py-1.5 mt-1 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-all cursor-default ${collapsed ? "justify-center" : ""}`}>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white text-[12px] font-bold shrink-0">
            OI
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-bold text-slate-900 dark:text-slate-100 truncate">Inspector</div>
              <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate">openinspection.dev</div>
            </div>
          )}
        </div>

        <a
          href="/logout"
          className={`flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[13px] font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-all ${collapsed ? "justify-center" : ""}`}
          title={collapsed ? "Sign out" : undefined}
        >
          <svg className={ICON_CLASS} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
          {!collapsed && <span>Sign Out</span>}
        </a>
      </div>
    </aside>
  );
}
