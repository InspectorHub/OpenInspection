import { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from "react";
import { useNavigate, useFetcher } from "react-router";
import { useSessionContext } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";
import { getPages, getSettings, RECENTS_CAP, type PaletteItem } from "./command-palette-items";
import { importEntryHref } from "~/lib/import-entry-points";
import type { ContactSearchItem } from "~/routes/resources/contact-search";

/**
 * Lets any workspace surface (the sidebar search button, MobileHeader) open the
 * command palette. The provider (auth-layout) owns the open state; consumers
 * call `openPalette()`. Default is a no-op so a stray consumer outside the
 * provider fails silently rather than throwing.
 */
const CommandPaletteContext = createContext<{ openPalette: () => void }>({ openPalette: () => {} });
export function useCommandPalette() {
  return useContext(CommandPaletteContext);
}
export const CommandPaletteProvider = CommandPaletteContext.Provider;

/* ------------------------------------------------------------------ */
/*  Quick actions                                                      */
/* ------------------------------------------------------------------ */

// A thunk, not a module const, so the Paraglide `m.*()` labels resolve inside
// the per-request locale scope instead of freezing at import.
function getQuickActions(): PaletteItem[] {
  return [
    { id: "qa-new-inspection", label: m.command_palette_action_new_inspection(), group: m.command_palette_group_quick_actions(), icon: "plus", hint: m.command_palette_action_hint_create() },
    // F65 — `?new=1` on these two is now READ by the page it lands on
    // (`routes/templates.tsx`, `routes/contacts.tsx`), which opens its own
    // create dialog. Until then nothing anywhere read the parameter: all three
    // of these actions navigated to a list page and stopped, with no overlay
    // and nothing to say why.
    { id: "qa-new-template", label: m.command_palette_action_new_template(), group: m.command_palette_group_quick_actions(), icon: "plus", hint: m.command_palette_action_hint_create(), to: "/library/templates?new=1" },
    { id: "qa-new-contact", label: m.command_palette_action_new_contact(), group: m.command_palette_group_quick_actions(), icon: "plus", hint: m.command_palette_action_hint_create(), to: "/contacts?new=1" },
    // F65 — this was `Import Spectora` pointing at `/library/templates?import=1`.
    // Both halves of that were stale. The paste-a-JSON-document importer and its
    // endpoint are gone; importing now runs through the staged wizard, whose
    // address `importEntryHref` owns so this entry cannot drift from the two
    // others that open it. The VENDOR NAME goes with it: the wizard's first
    // question is which product the file came from — Spectora is one of several
    // — so naming one here promised a shortcut that does not exist.
    { id: "qa-import", label: m.command_palette_action_import(), group: m.command_palette_group_quick_actions(), icon: "plus", to: importEntryHref("templates.create") },
  ];
}

/** A contact as a palette row. The server has already searched and ordered, so
 *  these are NOT re-scored client-side: `score()` only looks at the label, and
 *  re-filtering on it would throw away a row matched by email or agency. */
function toPeopleItems(contacts: ContactSearchItem[]): PaletteItem[] {
  return contacts.map((c) => ({
    id: `person-${c.id}`,
    label: c.name,
    group: m.command_palette_group_people(),
    icon: "person",
    hint: c.email ?? c.type,
    to: `/contacts/${c.id}`,
  }));
}

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

export function CommandPalette({
  open,
  onOpenChange,
  onNewInspection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewInspection?: () => void;
}) {
  const setOpen = onOpenChange;
  // The Cmd/Ctrl+K listener registers once (empty deps) but must toggle the
  // CURRENT open state — read it through a ref so the closure never goes stale.
  const openRef = useRef(open);
  openRef.current = open;
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const recentsFetcher = useFetcher<{ inspections: Array<Record<string, unknown>> }>();
  // F64 — the `@` prefix searches contacts on the SERVER. It cannot filter the
  // recents list client-side the way the other prefixes do: the palette holds
  // ten inspections and no contacts at all, which is why `@Marge` answered "No
  // results found" for a contact the product had.
  const peopleFetcher = useFetcher<{ contacts: ContactSearchItem[] }>();
  const sessionCtx = useSessionContext();

  // F6 — Build booking link action dynamically from session context
  const bookingActions = useMemo(() => {
    const actions: PaletteItem[] = [];
    const slug = sessionCtx?.branding?.currentUserSlug;
    const host = sessionCtx?.branding?.bookingHost;
    const tenant = sessionCtx?.branding?.tenantSlug;
    // Per-inspector booking deep links are retired: bookings go to the
    // company page and the server auto-assigns. `slug` still gates the action
    // to bookable inspectors, but the copied link is the company URL.
    if (slug && host && tenant) {
      const bookingUrl = `https://${host}/book/${tenant}`;
      actions.push({
        id: "qa-copy-booking-link",
        label: m.command_palette_action_copy_booking_link(),
        group: m.command_palette_group_quick_actions(),
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
        setOpen(!openRef.current);
        setQuery("");
        setActiveIdx(0);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setOpen]);

  // Focus input when opened; lazy-load recent inspections via BFF resource route
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      if (recentsFetcher.state === "idle" && !recentsFetcher.data) {
        recentsFetcher.load("/resources/recent-inspections");
      }
    }
  }, [open, recentsFetcher]);

  const isPeopleQuery = query.startsWith("@");
  const peopleTerm = isPeopleQuery ? query.replace(/^@\s*/, "") : "";

  // F64 — ask the server while the operator types. Debounced, because this is a
  // query per keystroke otherwise; `@` on its own is still a question ("show me
  // my contacts") and is sent as an empty term rather than withheld.
  useEffect(() => {
    if (!open || !isPeopleQuery) return;
    const t = setTimeout(() => {
      peopleFetcher.load(`/resources/contact-search?q=${encodeURIComponent(peopleTerm)}`);
    }, 180);
    return () => clearTimeout(t);
    // peopleFetcher is stable per instance; including it would re-arm the timer
    // on every state change it makes.
  }, [open, isPeopleQuery, peopleTerm]);

  // Build all actions
  const allItems = useMemo(() => {
    const isActions = query.startsWith(">");
    const isPeople = query.startsWith("@");
    const q = query.replace(/^[>@]\s*/, "");

    const dynamicQuickActions = [...getQuickActions(), ...bookingActions];

    // People are returned already searched and ordered by the contacts API, so
    // this branch leaves before the client-side scoring below: `score()` reads
    // the label only, and re-filtering on it would discard a contact the server
    // matched on email or agency.
    if (isPeople) return toPeopleItems(peopleFetcher.data?.contacts ?? []);

    let sources: PaletteItem[];
    if (isActions) {
      sources = dynamicQuickActions;
    } else {
      const recents: PaletteItem[] = (recentsFetcher.data?.inspections ?? []).slice(0, RECENTS_CAP).map((insp, i) => {
        // `propertyAddress` — the field the list endpoint actually publishes.
        // This read used to be `[insp.address1, insp.city, insp.state]`, none of
        // which the payload has ever carried (the columns are `address_street` /
        // `address_city` / `address_state`, and none of them is in the response
        // contract). Every entry therefore fell through to the id fallback, so
        // "Recent" has been listing six hex characters instead of addresses.
        const addr = (insp.propertyAddress as string | null) || m.command_palette_recent_fallback({ id: String(insp.id || "").slice(0, 6) });
        return {
          id: `ri-${i}`,
          label: addr as string,
          group: m.command_palette_group_recent(),
          icon: "clip",
          hint: (insp.status as string) || "",
          to: `/inspections/${insp.id}`,
        };
      });
      sources = [...getPages(), ...recents, ...getSettings(), ...dynamicQuickActions];
    }

    if (!q) return sources;
    return sources
      .map((item) => ({ item, score: score(item.label, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  }, [query, recentsFetcher.data, peopleFetcher.data, bookingActions]);

  // Group the filtered results. No per-group truncation: every source group is
  // already bounded (Pages/Settings are fixed lists; Recents is sliced to
  // RECENTS_CAP at its source; quick actions are few). A blanket cap here only
  // hid reachable-nowhere-else destinations (#IA-50).
  const groups = useMemo(() => {
    const map = new Map<string, PaletteItem[]>();
    for (const a of allItems) {
      const list = map.get(a.group) || [];
      list.push(a);
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
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] bg-ih-backdrop" onClick={() => setOpen(false)}>
      <div className="w-full max-w-md bg-ih-bg-card rounded-xl shadow-ih-popover border border-ih-border overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-ih-border">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder={m.command_palette_search_placeholder()}
            className="flex-1 bg-transparent text-[14px] text-ih-fg-1 outline-none placeholder:text-ih-fg-4"
          />
          <kbd className="hidden sm:inline px-1.5 py-0.5 rounded bg-ih-bg-muted text-[10px] font-bold text-ih-fg-2">ESC</kbd>
        </div>

        {/* Prefix hints */}
        {!query && (
          <div className="flex gap-3 px-4 py-1.5 border-b border-ih-border text-[10px] text-ih-fg-3">
            <span><kbd className="font-bold">&gt;</kbd> {m.command_palette_prefix_actions()}</span>
            <span><kbd className="font-bold">@</kbd> {m.command_palette_prefix_people()}</span>
          </div>
        )}

        {/* Results */}
        <div className="max-h-[300px] overflow-y-auto py-2">
          {flatFiltered.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-ih-fg-3">{m.command_palette_no_results()}</p>
          ) : (
            [...groups.entries()].map(([group, actions]) => (
              <div key={group}>
                <p className="px-4 py-1 text-[10px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-3">{group}</p>
                {actions.map((action) => {
                  const idx = flatFiltered.indexOf(action);
                  return (
                    <button
                      key={action.id}
                      onClick={() => executeAction(action)}
                      onMouseEnter={() => setActiveIdx(idx)}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-[13px] transition-colors ${idx === safeIdx ? "bg-ih-primary-tint text-ih-primary-text" : "text-ih-fg-3"}`}
                    >
                      <PaletteIcon type={action.icon} />
                      <span className="font-medium flex-1 text-left truncate">{action.label}</span>
                      {action.hint && (
                        <span className="text-[10px] text-ih-fg-3 shrink-0">{action.hint}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-ih-border text-[10px] text-ih-fg-3">
          <span><kbd className="font-bold">&uarr;&darr;</kbd> {m.command_palette_footer_navigate()}</span>
          <span><kbd className="font-bold">Enter</kbd> {m.command_palette_footer_select()}</span>
          <span><kbd className="font-bold">Esc</kbd> {m.command_palette_footer_close()}</span>
        </div>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg className="w-4 h-4 text-ih-fg-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  );
}
