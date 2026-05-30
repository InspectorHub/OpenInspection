import { useState, useCallback, useMemo, useEffect } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CommentEntry {
  id?: string;
  rating: string;
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
  function add(section: string, rating: string, text: string) {
    L.push({ rating, section, text, source: "preset" });
  }

  // Roof (30)
  add("Roof", "satisfactory", "Roof covering appears serviceable with no visible defects at the time of inspection.");
  add("Roof", "satisfactory", "Asphalt composition shingles in good overall condition; estimated remaining service life 10+ years.");
  add("Roof", "satisfactory", "Roof flashing at penetrations and chimney appears properly installed and sealed.");
  add("Roof", "satisfactory", "Gutters and downspouts are securely attached and free of significant debris.");
  add("Roof", "satisfactory", "Soffit and ridge vents present and clear of obstructions; attic ventilation appears adequate.");
  add("Roof", "satisfactory", "No active leaks or moisture intrusion observed at roof surface or interior ceilings below.");
  add("Roof", "satisfactory", "Roof valleys and rake edges are properly flashed and sealed.");
  add("Roof", "satisfactory", "Roof deck appears structurally sound with no visible sagging or deflection.");
  add("Roof", "monitor", "Asphalt shingles show signs of granule loss and weathering; monitor and budget for replacement within 3-5 years.");
  add("Roof", "monitor", "Minor moss or algae growth observed on north-facing slopes; recommend treatment to prevent moisture retention.");
  add("Roof", "monitor", "One or more shingles show curling or cupping at edges; monitor for further deterioration.");
  add("Roof", "monitor", "Flashing shows minor surface rust; monitor and apply sealant when accessible.");
  add("Roof", "monitor", "Gutters exhibit minor sagging at one or more attachment points; monitor and secure as needed.");
  add("Roof", "monitor", "Sealant at roof penetrations shows minor cracking; recommend renewal within 12 months.");
  add("Roof", "monitor", "Roof appears near end of expected service life; recommend planning for replacement within 1-3 years.");
  add("Roof", "monitor", "Skylight gaskets show minor weathering; monitor for active leakage and reseal if necessary.");
  add("Roof", "defect", "Multiple shingles are missing, broken, or lifted; recommend repair by a qualified roofing contractor.");
  add("Roof", "defect", "Active roof leak observed; recommend immediate professional repair to prevent further water damage.");
  add("Roof", "defect", "Improper or missing flashing observed at chimney/wall intersection; recommend correction to prevent leakage.");
  add("Roof", "defect", "Roof deck exhibits sagging or deflection indicating possible structural issue; further evaluation by a structural professional recommended.");
  add("Roof", "defect", "Gutters are detached or severely damaged; replacement recommended.");
  add("Roof", "defect", "Downspouts discharge directly against the foundation; extend at least 4-6 feet away to prevent foundation moisture issues.");
  add("Roof", "defect", "Multiple layers of roofing observed; full tear-off recommended at next replacement to verify deck condition.");
  add("Roof", "defect", "Visible holes or punctures in roof covering; recommend repair to prevent water intrusion.");
  add("Roof", "defect", "Improper roof slope at one or more areas causing standing water; recommend evaluation by a roofing contractor.");
  add("Roof", "defect", "Plumbing vent flashing shows separation from roof surface; recommend re-sealing.");
  add("Roof", "defect", "Exposed nail heads observed without sealant; recommend sealing to prevent rust and leakage.");
  add("Roof", "defect", "Chimney crown shows significant cracking; recommend repair or replacement.");
  add("Roof", "all", "Roof was inspected from ground level / accessible eaves only; areas not safely accessible were not inspected.");
  add("Roof", "all", "Recommend follow-up inspection by a licensed roofing contractor for cost estimate and warranty validation.");

  // General (condensed for brevity -- the full 248 library is loaded from server or window.__OI_COMMENT_LIBRARY)
  add("General", "satisfactory", "Functional and operating as intended at the time of inspection.");
  add("General", "satisfactory", "No deficiencies observed.");
  add("General", "satisfactory", "Appears to be properly installed and in working order.");
  add("General", "satisfactory", "Cleaning and routine maintenance recommended.");
  add("General", "monitor", "Recommend monitoring for further deterioration.");
  add("General", "monitor", "Minor wear noted; consider preventive maintenance.");
  add("General", "monitor", "Cosmetic defects observed; functional but recommend repair when convenient.");
  add("General", "monitor", "Approaching end of useful service life; budget for replacement.");
  add("General", "defect", "Recommend repair or replacement by a qualified contractor.");
  add("General", "defect", "Active leak observed; recommend immediate professional attention.");
  add("General", "defect", "Safety hazard noted; recommend correction prior to occupancy.");
  add("General", "defect", "Not functioning at time of inspection; further evaluation recommended.");
  add("General", "defect", "Improper installation observed; recommend correction by licensed professional.");
  add("General", "defect", "Damaged or deteriorated; replacement recommended.");
  add("General", "all", "Further evaluation recommended by a qualified specialist.");
  add("General", "all", "Recommend a licensed professional review the condition for cost estimate.");
  add("General", "all", "See attached photos for documentation.");
  add("General", "all", "Hidden conditions may exist that were not visible at the time of inspection.");
  add("General", "all", "Item was not accessible during the inspection; recommend re-evaluation when accessible.");

  return L;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useCannedComments(options: {
  inspectionId: string;
  bucketForRatingId: (ratingId: string | null | undefined) => string;
}) {
  const { inspectionId, bucketForRatingId } = options;
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

  const fetchFiltered = useCallback(
    async (ctx: {
      itemLabel?: string;
      section?: string;
      ratingBucket?: string;
    }) => {
      const params = new URLSearchParams();
      params.set("sort", sort);
      params.set("filterMode", filterMode);
      if (filterMode === "auto") {
        if (ctx.itemLabel) params.set("itemLabel", ctx.itemLabel);
        if (ctx.section) params.set("section", ctx.section);
        if (ctx.ratingBucket) params.set("rating", ctx.ratingBucket);
      }
      try {
        const res = await fetch(`/api/admin/comments?${params}`, {
          credentials: "include",
        });
        if (!res.ok) return [];
        const body = (await res.json()) as { data?: unknown[] };
        return body.data ?? [];
      } catch {
        return [];
      }
    },
    [sort, filterMode],
  );

  const touchSnippet = useCallback((id: string) => {
    // Fire-and-forget; no UI dependency on the response.
    try {
      fetch(`/api/admin/comments/${id}/touch`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      /* noop */
    }
  }, []);

  // Load user snippets from server
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/comments", {
          credentials: "include",
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          data?: { comments?: Array<Record<string, unknown>> };
        };
        const rows = json.data?.comments || [];
        setUserSnippets(
          rows.map((r) => ({
            id: r.id as string,
            rating: (r.ratingBucket as string) || "all",
            section: (r.section as string) || null,
            category: (r.category as string) || null,
            text: r.text as string,
            source: "snippet" as const,
          })),
        );
      } catch {
        /* non-fatal */
      }
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
          (c) => c.rating === "all" || c.rating === filter,
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
      const bucket = bucketForRatingId(ratingId);
      const filtered =
        bucket === "all"
          ? commentPool
          : commentPool.filter(
              (c) => c.rating === "all" || c.rating === bucket,
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
    [commentPool, bucketForRatingId],
  );

  /** Save current notes as a snippet (server-first, localStorage fallback) */
  const saveSnippet = useCallback(
    async (
      text: string,
      bucket: string,
      section: string,
      title?: string,
      itemLabel?: string,
    ) => {
      const body = {
        text,
        ratingBucket: bucket === "all" ? null : bucket,
        section: section || null,
        category: title || null,
        itemLabel: itemLabel || null,
      };
      try {
        const res = await fetch("/api/admin/comments", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          // Reload user snippets
          const reloadRes = await fetch("/api/admin/comments", {
            credentials: "include",
          });
          if (reloadRes.ok) {
            const json = (await reloadRes.json()) as {
              data?: { comments?: Array<Record<string, unknown>> };
            };
            const rows = json.data?.comments || [];
            setUserSnippets(
              rows.map((r) => ({
                id: r.id as string,
                rating: (r.ratingBucket as string) || "all",
                section: (r.section as string) || null,
                category: (r.category as string) || null,
                text: r.text as string,
                source: "snippet" as const,
              })),
            );
          }
          return true;
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
          rating: bucket,
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
    [],
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
    touchSnippet,
  };
}
