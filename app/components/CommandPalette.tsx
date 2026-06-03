import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { useSessionContext } from "~/hooks/useSessionContext";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PaletteItem {
  id: string;
  label: string;
  group: string;
  hint?: string;
  icon: string;
  to?: string;
  onSelect?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Static sources                                                     */
/* ------------------------------------------------------------------ */

const PAGES: PaletteItem[] = [
  { id: "p-dashboard", label: "Dashboard", group: "Pages", icon: "page", to: "/dashboard", hint: "G then I" },
  { id: "p-reports", label: "Reports", group: "Pages", icon: "page", to: "/reports", hint: "G then R" },
  { id: "p-templates", label: "Templates", group: "Pages", icon: "page", to: "/templates", hint: "G then T" },
  { id: "p-marketplace", label: "Marketplace", group: "Pages", icon: "page", to: "/marketplace" },
  { id: "p-agreements", label: "Agreements", group: "Pages", icon: "page", to: "/agreements" },
  { id: "p-comments", label: "Comments", group: "Pages", icon: "page", to: "/comments" },
  { id: "p-repair", label: "Repair Items", group: "Pages", icon: "page", to: "/recommendations" },
  { id: "p-contacts", label: "Contacts", group: "Pages", icon: "page", to: "/contacts", hint: "G then C" },
  { id: "p-calendar", label: "Calendar", group: "Pages", icon: "page", to: "/calendar" },
  { id: "p-invoices", label: "Invoices", group: "Pages", icon: "page", to: "/invoices" },
  { id: "p-ratings", label: "Rating Systems", group: "Pages", icon: "page", to: "/library/rating-systems" },
  { id: "p-metrics", label: "Metrics", group: "Pages", icon: "page", to: "/metrics" },
  { id: "p-notifications", label: "Notifications", group: "Pages", icon: "page", to: "/notifications" },
];

const SETTINGS: PaletteItem[] = [
  { id: "s-main", label: "Settings", group: "Settings", icon: "gear", to: "/settings" },
  { id: "s-profile", label: "Settings - Profile", group: "Settings", icon: "gear", to: "/settings/profile" },
  { id: "s-branding", label: "Settings - Branding", group: "Settings", icon: "gear", to: "/settings/workspace/branding" },
  { id: "s-theme", label: "Settings - Report Theme", group: "Settings", icon: "gear", to: "/settings/workspace/theme" },
  { id: "s-services", label: "Settings - Services & Pricing", group: "Settings", icon: "gear", to: "/settings/catalog/services" },
  { id: "s-email", label: "Settings - Email", group: "Settings", icon: "gear", to: "/settings/communication/email" },
  { id: "s-automations", label: "Settings - Automations", group: "Settings", icon: "gear", to: "/settings/communication/automations" },
  { id: "s-integrations", label: "Settings - Integrations", group: "Settings", icon: "gear", to: "/settings/communication/integrations" },
  { id: "s-password", label: "Settings - Change Password", group: "Settings", icon: "gear", to: "/settings/account/password" },
  { id: "s-2fa", label: "Settings - Two-factor (2FA)", group: "Settings", icon: "gear", to: "/settings/account/security" },
  { id: "s-payments", label: "Settings - Payments", group: "Settings", icon: "gear", to: "/settings/advanced/payments" },
  { id: "s-ai", label: "Settings - AI", group: "Settings", icon: "gear", to: "/settings/advanced/ai" },
  { id: "s-data", label: "Settings - Data Import / Export", group: "Settings", icon: "gear", to: "/settings/advanced/data" },
];

const QUICK_ACTIONS: PaletteItem[] = [
  { id: "qa-new-inspection", label: "New Inspection", group: "Quick Actions", icon: "plus", hint: "create" },
  { id: "qa-new-template", label: "New Template", group: "Quick Actions", icon: "plus", hint: "create", to: "/templates?new=1" },
  { id: "qa-new-contact", label: "New Contact", group: "Quick Actions", icon: "plus", hint: "create", to: "/contacts?new=1" },
  { id: "qa-import", label: "Import Spectora", group: "Quick Actions", icon: "plus", to: "/templates?import=1" },
];

/* ------------------------------------------------------------------ */
/*  Fuzzy scoring                                                      */
/* ------------------------------------------------------------------ */

function score(label: string, query: string): number {
  if (!query) return 1;
  const l = label.toLowerCase();
  const q = query.toLowerCase();
  if (l === q) return 1000;
  if (l.startsWith(q)) return 500 + (q.length / l.length) * 100;
  const idx = l.indexOf(q);
  if (idx >= 0) return 200 + (q.length / l.length) * 100 - idx;
  // Subsequence fallback
  let li = 0, qi = 0, hits = 0;
  while (li < l.length && qi < q.length) {
    if (l[li] === q[qi]) { hits++; qi++; }
    li++;
  }
  return qi === q.length ? hits : -1;
}

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

function PaletteIcon({ type }: { type: string }) {
  switch (type) {
    case "gear":
      return (
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-4 h-4 opacity-50">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    case "plus":
      return (
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-4 h-4 opacity-50">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      );
    case "person":
      return (
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-4 h-4 opacity-50">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      );
    case "clip":
      return (
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-4 h-4 opacity-50">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      );
    default:
      return (
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-4 h-4 opacity-50">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function CommandPalette({ onNewInspection }: { onNewInspection?: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [recentInspections, setRecentInspections] = useState<PaletteItem[]>([]);
  const [loadedRecents, setLoadedRecents] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const sessionCtx = useSessionContext();

  // F6 — Build booking link action dynamically from session context
  const bookingActions = useMemo(() => {
    const actions: PaletteItem[] = [];
    const slug = sessionCtx?.branding?.currentUserSlug;
    const host = sessionCtx?.branding?.bookingHost;
    const tenant = sessionCtx?.branding?.tenantSlug;
    if (slug && host && tenant) {
      const bookingUrl = `https://${host}/book/${tenant}/${slug}`;
      actions.push({
        id: "qa-copy-booking-link",
        label: "Copy my booking link",
        group: "Quick Actions",
        icon: "clip",
        hint: bookingUrl,
        onSelect: () => {
          navigator.clipboard.writeText(bookingUrl).catch(() => {});
        },
      });
    }
    return actions;
  }, [sessionCtx]);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery("");
        setActiveIdx(0);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      // Lazy load recent inspections
      if (!loadedRecents) {
        fetch("/api/inspections?pageSize=10", { credentials: "include" })
          .then((r) => r.ok ? r.json() : null)
          .then((j) => {
            if (!j) return;
            const list = ((j as Record<string, unknown>)?.data as Array<Record<string, unknown>>) || [];
            setRecentInspections(
              list.slice(0, 10).map((insp, i) => {
                const addr = [insp.address1, insp.city, insp.state].filter(Boolean).join(", ") || `Inspection #${String(insp.id || "").slice(0, 6)}`;
                return {
                  id: `ri-${i}`,
                  label: addr as string,
                  group: "Recent Inspections",
                  icon: "clip",
                  hint: (insp.status as string) || "",
                  to: `/inspections/${insp.id}/edit`,
                };
              }),
            );
            setLoadedRecents(true);
          })
          .catch(() => { /* silent */ });
      }
    }
  }, [open, loadedRecents]);

  // Build all actions
  const allItems = useMemo(() => {
    const isActions = query.startsWith(">");
    const isPeople = query.startsWith("@");
    const q = query.replace(/^[>@]\s*/, "");

    const dynamicQuickActions = [...QUICK_ACTIONS, ...bookingActions];

    let sources: PaletteItem[];
    if (isActions) {
      sources = dynamicQuickActions;
    } else if (isPeople) {
      sources = []; // contacts would need a search endpoint
    } else {
      sources = [...PAGES, ...recentInspections, ...SETTINGS, ...dynamicQuickActions];
    }

    if (!q) return sources;
    return sources
      .map((item) => ({ item, score: score(item.label, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  }, [query, recentInspections]);

  // Group the filtered results
  const groups = useMemo(() => {
    const map = new Map<string, PaletteItem[]>();
    for (const a of allItems) {
      const list = map.get(a.group) || [];
      if (list.length < 8) list.push(a);
      map.set(a.group, list);
    }
    return map;
  }, [allItems]);

  const flatFiltered = useMemo(() => {
    const out: PaletteItem[] = [];
    for (const items of groups.values()) out.push(...items);
    return out;
  }, [groups]);

  const safeIdx = Math.min(activeIdx, Math.max(0, flatFiltered.length - 1));

  const executeAction = useCallback((action: PaletteItem) => {
    setOpen(false);
    if (action.id === "qa-new-inspection" && onNewInspection) {
      onNewInspection();
    } else if (action.to) {
      navigate(action.to);
    } else if (action.onSelect) {
      action.onSelect();
    }
  }, [navigate, onNewInspection]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flatFiltered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && flatFiltered[safeIdx]) {
      e.preventDefault();
      executeAction(flatFiltered[safeIdx]);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] bg-black/30 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div className="w-full max-w-md bg-ih-bg-card rounded-xl shadow-2xl border border-ih-border overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-ih-border">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-[14px] text-ih-fg-1 outline-none placeholder:text-slate-400"
          />
          <kbd className="hidden sm:inline px-1.5 py-0.5 rounded bg-ih-bg-muted text-[10px] font-bold text-slate-400">ESC</kbd>
        </div>

        {/* Prefix hints */}
        {!query && (
          <div className="flex gap-3 px-4 py-1.5 border-b border-slate-100 dark:border-slate-700 text-[10px] text-slate-400">
            <span><kbd className="font-bold">&gt;</kbd> actions</span>
            <span><kbd className="font-bold">@</kbd> people</span>
          </div>
        )}

        {/* Results */}
        <div className="max-h-[300px] overflow-y-auto py-2">
          {flatFiltered.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-slate-400">No results found</p>
          ) : (
            [...groups.entries()].map(([group, actions]) => (
              <div key={group}>
                <p className="px-4 py-1 text-[10px] font-extrabold uppercase tracking-[0.15em] text-slate-400">{group}</p>
                {actions.map((action) => {
                  const idx = flatFiltered.indexOf(action);
                  return (
                    <button
                      key={action.id}
                      onClick={() => executeAction(action)}
                      onMouseEnter={() => setActiveIdx(idx)}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-[13px] transition-colors ${idx === safeIdx ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400" : "text-ih-fg-3"}`}
                    >
                      <PaletteIcon type={action.icon} />
                      <span className="font-medium flex-1 text-left truncate">{action.label}</span>
                      {action.hint && (
                        <span className="text-[10px] text-slate-400 shrink-0">{action.hint}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-ih-border text-[10px] text-slate-400">
          <span><kbd className="font-bold">&uarr;&darr;</kbd> navigate</span>
          <span><kbd className="font-bold">Enter</kbd> select</span>
          <span><kbd className="font-bold">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  );
}
