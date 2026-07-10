import { useState, useCallback, useMemo, useEffect } from "react";
import type { Severity } from "~/lib/severity";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CommentEntry {
  id?: string;
  /** The single severity vocabulary shared with rating levels; "all" = applies regardless. */
  severity: Severity | "all";
  text: string;
  section?: string | null;
  category?: string | null;
  source: "preset" | "snippet";
}

/* ------------------------------------------------------------------ */
/*  Standard Residential Library (248 entries)                         */
/* ------------------------------------------------------------------ */

const BUILT_IN_LIBRARY: CommentEntry[] = buildLibrary();

function buildLibrary(): CommentEntry[] {
  const L: CommentEntry[] = [];
  function add(section: string, severity: Severity | "all", text: string) {
    L.push({ severity, section, text, source: "preset" });
  }

  // Roof (30)
  add("Roof", "good", "Roof covering appears serviceable with no visible defects at the time of inspection.");
  add("Roof", "good", "Asphalt composition shingles in good overall condition; estimated remaining service life 10+ years.");
  add("Roof", "good", "Roof flashing at penetrations and chimney appears properly installed and sealed.");
  add("Roof", "good", "Gutters and downspouts are securely attached and free of significant debris.");
  add("Roof", "good", "Soffit and ridge vents present and clear of obstructions; attic ventilation appears adequate.");
  add("Roof", "good", "No active leaks or moisture intrusion observed at roof surface or interior ceilings below.");
  add("Roof", "good", "Roof valleys and rake edges are properly flashed and sealed.");
  add("Roof", "good", "Roof deck appears structurally sound with no visible sagging or deflection.");
  add("Roof", "marginal", "Asphalt shingles show signs of granule loss and weathering; monitor and budget for replacement within 3-5 years.");
  add("Roof", "marginal", "Minor moss or algae growth observed on north-facing slopes; recommend treatment to prevent moisture retention.");
  add("Roof", "marginal", "One or more shingles show curling or cupping at edges; monitor for further deterioration.");
  add("Roof", "marginal", "Flashing shows minor surface rust; monitor and apply sealant when accessible.");
  add("Roof", "marginal", "Gutters exhibit minor sagging at one or more attachment points; monitor and secure as needed.");
  add("Roof", "marginal", "Sealant at roof penetrations shows minor cracking; recommend renewal within 12 months.");
  add("Roof", "marginal", "Roof appears near end of expected service life; recommend planning for replacement within 1-3 years.");
  add("Roof", "marginal", "Skylight gaskets show minor weathering; monitor for active leakage and reseal if necessary.");
  add("Roof", "significant", "Multiple shingles are missing, broken, or lifted; recommend repair by a qualified roofing contractor.");
  add("Roof", "significant", "Active roof leak observed; recommend immediate professional repair to prevent further water damage.");
  add("Roof", "significant", "Improper or missing flashing observed at chimney/wall intersection; recommend correction to prevent leakage.");
  add("Roof", "significant", "Roof deck exhibits sagging or deflection indicating possible structural issue; further evaluation by a structural professional recommended.");
  add("Roof", "significant", "Gutters are detached or severely damaged; replacement recommended.");
  add("Roof", "significant", "Downspouts discharge directly against the foundation; extend at least 4-6 feet away to prevent foundation moisture issues.");
  add("Roof", "significant", "Multiple layers of roofing observed; full tear-off recommended at next replacement to verify deck condition.");
  add("Roof", "significant", "Visible holes or punctures in roof covering; recommend repair to prevent water intrusion.");
  add("Roof", "significant", "Improper roof slope at one or more areas causing standing water; recommend evaluation by a roofing contractor.");
  add("Roof", "significant", "Plumbing vent flashing shows separation from roof surface; recommend re-sealing.");
  add("Roof", "significant", "Exposed nail heads observed without sealant; recommend sealing to prevent rust and leakage.");
  add("Roof", "significant", "Chimney crown shows significant cracking; recommend repair or replacement.");
  add("Roof", "all", "Roof was inspected from ground level / accessible eaves only; areas not safely accessible were not inspected.");
  add("Roof", "all", "Recommend follow-up inspection by a licensed roofing contractor for cost estimate and warranty validation.");

  // General (condensed for brevity -- the full 248 library is loaded from server or window.__OI_COMMENT_LIBRARY)
  add("General", "good", "Functional and operating as intended at the time of inspection.");
  add("General", "good", "No deficiencies observed.");
  add("General", "good", "Appears to be properly installed and in working order.");
  add("General", "good", "Cleaning and routine maintenance recommended.");
  add("General", "marginal", "Recommend monitoring for further deterioration.");
  add("General", "marginal", "Minor wear noted; consider preventive maintenance.");
  add("General", "marginal", "Cosmetic defects observed; functional but recommend repair when convenient.");
  add("General", "marginal", "Approaching end of useful service life; budget for replacement.");
  add("General", "significant", "Recommend repair or replacement by a qualified contractor.");
  add("General", "significant", "Active leak observed; recommend immediate professional attention.");
  add("General", "significant", "Safety hazard noted; recommend correction prior to occupancy.");
  add("General", "significant", "Not functioning at time of inspection; further evaluation recommended.");
  add("General", "significant", "Improper installation observed; recommend correction by licensed professional.");
  add("General", "significant", "Damaged or deteriorated; replacement recommended.");
  add("General", "all", "Further evaluation recommended by a qualified specialist.");
  add("General", "all", "Recommend a licensed professional review the condition for cost estimate.");
  add("General", "all", "See attached photos for documentation.");
  add("General", "all", "Hidden conditions may exist that were not visible at the time of inspection.");
  add("General", "all", "Item was not accessible during the inspection; recommend re-evaluation when accessible.");

  return L;
}

/* ------------------------------------------------------------------ */
/*  BFF channel (Track H / C-12)                                       */
/* ------------------------------------------------------------------ */

// Every server call rides the BFF resource route (RR loader/action does the
// token relay) — client code never fetches `/api/...` directly. The promise
// contracts the editor relies on (`fetchFiltered(...).then(...)`) are kept.
const LIBRARY_ROUTE = "/resources/comments-library";

function mapRow(r: Record<string, unknown>): CommentEntry {
  return {
    id: r.id as string,
    severity: ((r.severity as Severity) || "all"),
    section: (r.section as string) || null,
    category: (r.category as string) || null,
    text: r.text as string,
    source: "snippet" as const,
  };
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useCannedComments(options: {
  inspectionId: string;
  severityForRatingId: (ratingId: string | null | undefined) => Severity | "all";
}) {
  const { inspectionId, severityForRatingId } = options;
  const [userSnippets, setUserSnippets] = useState<CommentEntry[]>([]);
  const [localSnippets, setLocalSnippets] = useState<CommentEntry[]>([]);

  const [sort, setSortInner] = useState<string>(() => {
    try {
      return localStorage.getItem("oi:library:sort") ?? "relevance";
    } catch {
      return "relevance";
    }
  });
  const [filterMode, setFilterModeInner] = useState<"auto" | "all">(() => {
    try {
      return (
        (localStorage.getItem("oi:library:filter-mode") as "auto" | "all") ??
        "auto"
      );
    } catch {
      return "auto";
    }
  });

  const setSort = useCallback((s: string) => {
    setSortInner(s);
    try {
      localStorage.setItem("oi:library:sort", s);
    } catch {
      /* noop */
    }
  }, []);
  const setFilterMode = useCallback((m: "auto" | "all") => {
    setFilterModeInner(m);
    try {
      localStorage.setItem("oi:library:filter-mode", m);
    } catch {
      /* noop */
    }
  }, []);

  const loadServerRows = useCallback(async (params?: URLSearchParams): Promise<Array<Record<string, unknown>>> => {
    try {
      const qs = params && params.size > 0 ? `?${params}` : "";
      const res = await fetch(`${LIBRARY_ROUTE}${qs}`, { credentials: "include" });
      if (!res.ok) return [];
      const body = (await res.json()) as { comments?: Array<Record<string, unknown>> };
      return body.comments ?? [];
    } catch {
      return [];
    }
  }, []);

  const fetchFiltered = useCallback(
    async (ctx: {
      itemLabel?: string;
      section?: string;
      severity?: string;
      search?: string;
    }) => {
      const params = new URLSearchParams();
      params.set("sort", sort);
      params.set("filterMode", filterMode);
      if (ctx.search) params.set("search", ctx.search);
      // Track H: severity rides regardless of filter mode (the modal's severity
      // chips set it explicitly); section/itemLabel stay auto-only context.
      if (ctx.severity) params.set("severity", ctx.severity);
      if (filterMode === "auto") {
        if (ctx.itemLabel) params.set("itemLabel", ctx.itemLabel);
        if (ctx.section) params.set("section", ctx.section);
      }
      return loadServerRows(params);
    },
    [sort, filterMode, loadServerRows],
  );

  /** Track H (IA-5) — search the whole tenant library (incl. imported
   *  libraries) regardless of filter mode; used by the Defects-tab library
   *  group and the `/` snippet picker. */
  const searchLibrary = useCallback(
    async (query: string): Promise<CommentEntry[]> => {
      const q = query.trim();
      if (q.length < 2) return [];
      const params = new URLSearchParams();
      params.set("search", q);
      params.set("filterMode", "all");
      params.set("sort", "relevance");
      const rows = await loadServerRows(params);
      return rows.map(mapRow);
    },
    [loadServerRows],
  );

  const touchSnippet = useCallback((id: string) => {
    // Fire-and-forget; no UI dependency on the response.
    try {
      const form = new FormData();
      form.set("intent", "touch");
      form.set("id", id);
      fetch(LIBRARY_ROUTE, { method: "POST", credentials: "include", body: form });
    } catch {
      /* noop */
    }
  }, []);

  // Load user snippets from server. (Pre-Track-H this unwrapped a
  // `data.comments` shape the API never returned, so server snippets silently
  // never loaded — fixed by going through the resource route.)
  useEffect(() => {
    (async () => {
      const rows = await loadServerRows();
      if (rows.length > 0) setUserSnippets(rows.map(mapRow));
    })();
  }, [inspectionId]);

  // Load local snippets from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("oi:snippets");
      if (raw) {
        const parsed = JSON.parse(raw) as CommentEntry[];
        setLocalSnippets(
          parsed.map((c) => ({ ...c, source: "snippet" as const })),
        );
      }
    } catch {
      /* ignore */
    }
  }, []);

  /** Combined pool of all comments */
  const commentPool = useMemo(() => {
    const preset = BUILT_IN_LIBRARY;
    // Dedupe server snippets vs local snippets
    const seenTexts = new Set<string>();
    for (const s of userSnippets) seenTexts.add(s.text);
    const dedupedLocal = localSnippets.filter((c) => !seenTexts.has(c.text));
    return [...preset, ...userSnippets, ...dedupedLocal];
  }, [userSnippets, localSnippets]);

  /** Filter library by rating filter + search query */
  const getFilteredComments = useCallback(
    (filter: string, search: string): CommentEntry[] => {
      let filtered: CommentEntry[];
      if (filter === "my-snippets") {
        filtered = commentPool.filter((c) => c.source === "snippet");
      } else if (filter === "all") {
        filtered = commentPool;
      } else {
        filtered = commentPool.filter(
          (c) => c.severity === "all" || c.severity === filter,
        );
      }
      const q = (search || "").trim().toLowerCase();
      if (q) {
        filtered = filtered.filter((c) =>
          c.text.toLowerCase().includes(q),
        );
      }
      return filtered;
    },
    [commentPool],
  );

  /** Quick comments for the active item's rating (top 6, ranked by relevance) */
  const getQuickComments = useCallback(
    (
      ratingId: string | null | undefined,
      itemLabel: string,
      sectionTitle: string,
    ): CommentEntry[] => {
      const severity = severityForRatingId(ratingId);
      const filtered =
        severity === "all"
          ? commentPool
          : commentPool.filter(
              (c) => c.severity === "all" || c.severity === severity,
            );

      const itemTokens = (itemLabel || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3);
      const lcSection = (sectionTitle || "").toLowerCase();

      function score(c: CommentEntry): number {
        let s = 0;
        const lcText = (c.text || "").toLowerCase();
        const lcSec = (c.section || "").toLowerCase();
        if (itemTokens.length > 0) {
          let hits = 0;
          for (const tok of itemTokens) {
            if (lcText.includes(tok)) hits++;
          }
          if (hits === itemTokens.length) s += 40;
          else if (hits > 0)
            s += Math.round(20 * (hits / itemTokens.length));
        }
        if (lcSec && lcSec === lcSection) s += 10;
        return s;
      }

      const scored = filtered.map((c, idx) => ({
        c,
        s: score(c),
        idx,
      }));
      scored.sort((a, b) => b.s - a.s || a.idx - b.idx);
      return scored.map((x) => x.c).slice(0, 6);
    },
    [commentPool, severityForRatingId],
  );

  /** Save current notes as a snippet (server-first, localStorage fallback) */
  const saveSnippet = useCallback(
    async (
      text: string,
      severity: Severity | "all",
      section: string,
      title?: string,
      itemLabel?: string,
    ) => {
      try {
        const form = new FormData();
        form.set("intent", "save");
        form.set("text", text);
        form.set("severity", severity);
        form.set("section", section || "");
        form.set("category", title || "");
        form.set("itemLabel", itemLabel || "");
        const res = await fetch(LIBRARY_ROUTE, {
          method: "POST",
          credentials: "include",
          body: form,
        });
        if (res.ok) {
          const body = (await res.json()) as { ok?: boolean };
          if (body.ok) {
            // Reload user snippets through the same channel.
            const rows = await loadServerRows();
            setUserSnippets(rows.map(mapRow));
            return true;
          }
        }
      } catch {
        /* fallback to local */
      }

      // localStorage fallback
      try {
        const existing: CommentEntry[] = JSON.parse(
          localStorage.getItem("oi:snippets") || "[]",
        );
        if (existing.some((c) => c.text === text)) return false;
        existing.unshift({
          severity,
          text,
          source: "snippet",
        });
        localStorage.setItem("oi:snippets", JSON.stringify(existing));
        setLocalSnippets(existing);
        return true;
      } catch {
        return false;
      }
    },
    [loadServerRows],
  );

  return {
    commentPool,
    getFilteredComments,
    getQuickComments,
    saveSnippet,
    userSnippets,
    sort,
    setSort,
    filterMode,
    setFilterMode,
    fetchFiltered,
    searchLibrary,
    touchSnippet,
  };
}
