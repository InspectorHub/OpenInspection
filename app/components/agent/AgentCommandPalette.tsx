import { useState, useEffect, useRef, useCallback, useMemo } from "react";

export interface AgentCommandPaletteInspector {
  name: string | null;
  slug: string | null;
  tenantSubdomain: string;
}

interface AgentCommandPaletteProps {
  inspectors: AgentCommandPaletteInspector[];
  agentSlug: string | null;
  bookingHost: string;
}

interface PaletteItem {
  id: string;
  group: "Pages" | "Actions";
  label: string;
  hint?: string;
  href?: string;
  action?: "signout" | "copy";
  payload?: string;
}

export function AgentCommandPalette({ inspectors, agentSlug, bookingHost }: AgentCommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [toast, setToast] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = [
      { id: "page-dashboard", group: "Pages", label: "Dashboard", hint: "G then D", href: "/agent-dashboard" },
      { id: "page-inspectors", group: "Pages", label: "Inspectors", hint: "G then I", href: "/agent-inspectors" },
      { id: "page-settings", group: "Pages", label: "Settings", hint: "G then S", href: "/agent-settings/profile" },
      { id: "action-signout", group: "Actions", label: "Log out", hint: "log out", action: "signout" },
    ];
    const ref = agentSlug ? `?ref=${encodeURIComponent(agentSlug)}` : "";
    for (const insp of inspectors) {
      if (!insp.slug) continue;
      const url = `https://${bookingHost}/book/${insp.tenantSubdomain}/${insp.slug}${ref}`;
      const displayName = insp.name?.trim() || insp.slug;
      list.push({ id: `copy-${insp.tenantSubdomain}-${insp.slug}`, group: "Actions", label: `Copy booking link — ${displayName}`, hint: "copy", action: "copy", payload: url });
    }
    return list;
  }, [inspectors, agentSlug, bookingHost]);

  const visible = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter((i) => i.label.toLowerCase().includes(q));
  }, [items, query]);

  const activate = useCallback((item: PaletteItem | undefined) => {
    if (!item) return;
    if (item.href) { window.location.href = item.href; return; }
    if (item.action === "signout") {
      fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {}).then(() => { window.location.href = "/login"; });
      return;
    }
    if (item.action === "copy" && item.payload) {
      navigator.clipboard?.writeText(item.payload).then(() => {
        setToast(`Copied ${item.payload}`);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setToast(""), 1800);
      }).catch(() => {});
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if ((meta && e.key === "k") || (meta && e.key === "/")) {
        e.preventDefault();
        setOpen((prev) => {
          if (!prev) { setQuery(""); setHighlighted(0); setTimeout(() => inputRef.current?.focus(), 50); }
          return !prev;
        });
      }
      if (e.key === "Escape" && open) { setOpen(false); e.stopPropagation(); }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open]);

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((h) => (visible.length ? (h + 1) % visible.length : 0)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted((h) => (visible.length ? (h - 1 + visible.length) % visible.length : 0)); }
    if (e.key === "Enter") { e.preventDefault(); activate(visible[highlighted]); }
  }

  if (!open && !toast) return null;

  const pages = visible.filter((i) => i.group === "Pages");
  const actions = visible.filter((i) => i.group === "Actions");

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-[10000] flex items-start justify-center pt-[12vh] px-4" role="dialog" aria-modal="true" aria-label="Agent command palette" data-testid="agent-command-palette">
          <div className="absolute inset-0 bg-stone-900/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-[36rem] bg-ih-bg-card border border-stone-200 dark:border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[70vh]">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-stone-100 dark:border-white/5">
              <span className="font-bold text-lg tracking-tight text-stone-900 dark:text-slate-100 mr-auto" style={{ fontFamily: "'Fraunces', serif" }}>Quick search</span>
              <span className="text-[11px] text-stone-500 dark:text-slate-400 px-2 py-1 border border-stone-200 dark:border-white/10 rounded-md font-mono">Esc to close</span>
            </div>
            <div className="flex items-center gap-2.5 px-5 py-2.5 border-b border-stone-100 dark:border-white/5">
              <svg className="w-[18px] h-[18px] text-stone-400 dark:text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M16.5 10.5a6 6 0 11-12 0 6 6 0 0112 0z" /></svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setHighlighted(0); }}
                onKeyDown={onInputKey}
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="Jump to a page or run a quick action..."
                className="flex-1 border-0 outline-0 bg-transparent text-[15px] text-stone-900 dark:text-slate-100 placeholder:text-stone-400 dark:placeholder:text-ih-fg-3 py-1"
              />
            </div>
            <div className="flex-1 overflow-y-auto pb-2">
              {visible.length === 0 && <div className="py-10 text-center text-stone-500 dark:text-slate-400 text-sm">No matches.</div>}
              {pages.length > 0 && (
                <div>
                  <div className="px-5 pt-3 pb-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-stone-400 dark:text-slate-500">Pages</div>
                  {pages.map((item) => {
                    const vi = visible.indexOf(item);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`flex items-center gap-3 w-full px-5 py-2.5 text-left text-[15px] cursor-pointer transition-colors ${highlighted === vi ? "bg-indigo-500/10 text-ih-primary" : "text-stone-900 dark:text-slate-200"}`}
                        onMouseEnter={() => setHighlighted(vi)}
                        onClick={() => activate(item)}
                        data-testid={`agent-cmdk-item-${item.id}`}
                      >
                        <span className="flex-1 min-w-0">{item.label}</span>
                        {item.hint && <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-stone-400 dark:text-slate-500">{item.hint}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
              {actions.length > 0 && (
                <div>
                  <div className="px-5 pt-3 pb-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-stone-400 dark:text-slate-500">Actions</div>
                  {actions.map((item) => {
                    const vi = visible.indexOf(item);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`flex items-center gap-3 w-full px-5 py-2.5 text-left text-[15px] cursor-pointer transition-colors ${highlighted === vi ? "bg-indigo-500/10 text-ih-primary" : "text-stone-900 dark:text-slate-200"}`}
                        onMouseEnter={() => setHighlighted(vi)}
                        onClick={() => activate(item)}
                        data-testid={`agent-cmdk-item-${item.id}`}
                      >
                        <span className="flex-1 min-w-0">{item.label}</span>
                        {item.hint && <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-stone-400 dark:text-slate-500">{item.hint}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between px-5 py-2.5 border-t border-stone-100 dark:border-white/5 bg-stone-50 dark:bg-white/[0.02] text-[11px] text-stone-500 dark:text-slate-400 tracking-wide">
              <span><kbd className="bg-ih-bg-card border border-stone-200 dark:border-white/10 rounded px-1.5 py-0.5 font-mono text-[10px] text-stone-900 dark:text-slate-200 mx-0.5">&uarr;</kbd><kbd className="bg-ih-bg-card border border-stone-200 dark:border-white/10 rounded px-1.5 py-0.5 font-mono text-[10px] text-stone-900 dark:text-slate-200 mx-0.5">&darr;</kbd> navigate &middot; <kbd className="bg-ih-bg-card border border-stone-200 dark:border-white/10 rounded px-1.5 py-0.5 font-mono text-[10px] text-stone-900 dark:text-slate-200 mx-0.5">&crarr;</kbd> open &middot; <kbd className="bg-ih-bg-card border border-stone-200 dark:border-white/10 rounded px-1.5 py-0.5 font-mono text-[10px] text-stone-900 dark:text-slate-200 mx-0.5">&amp;#8984;K</kbd> toggle</span>
              <span>{inspectors.length} {inspectors.length === 1 ? "inspector" : "inspectors"}</span>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-stone-900 dark:bg-slate-100 text-white dark:text-slate-900 px-4 py-2.5 rounded-full text-[13px] shadow-xl z-[10001]">
          {toast}
        </div>
      )}
    </>
  );
}
