import { useState, useCallback, useMemo, useRef, useEffect } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface RatingLevel {
  id: string;
  label: string;
  name?: string;
  abbreviation?: string;
  color: string;
  severity?: string;
  isDefect?: boolean;
  description?: string;
}

export interface SchemaItem {
  id: string;
  label: string;
  name?: string;
  type: string;
  tabs?: {
    information?: CannedComment[];
    limitations?: CannedComment[];
    defects?: CannedDefect[];
  };
  ratingOptions?: string[];
  source?: string;
}

export interface CannedComment {
  id: string;
  title: string;
  comment: string;
  default: boolean;
}

export interface CannedDefect {
  id: string;
  title: string;
  comment: string;
  category: string;
  location: string;
  photos: string[];
  default: boolean;
}

export interface SchemaSection {
  id: string;
  title: string;
  name?: string;
  icon?: string;
  items: SchemaItem[];
}

export interface Inspection {
  id: string;
  propertyAddress?: string;
  clientName?: string;
  clientEmail?: string;
  date?: string;
  scheduledDate?: string;
  createdAt?: string;
  status?: string;
  propertyType?: string;
  teamMode?: boolean;
  paymentRequired?: boolean;
  agreementRequired?: boolean;
  templateSnapshot?: unknown;
  [key: string]: unknown;
}

export interface InspectionSchema {
  sections: SchemaSection[];
}

export type ResultMap = Record<string, Record<string, unknown>>;

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export type ActiveView = "items" | "property";

export type ViewMode = "split" | "focus" | "preview";

export type ItemFilter = "all" | "unrated" | "issues" | "flagged";

/* ------------------------------------------------------------------ */
/*  Fallback rating level descriptions                                 */
/* ------------------------------------------------------------------ */

const FALLBACK_DESCRIPTIONS: Record<string, string> = {
  S: "Item is functioning as intended; no concerns observed.",
  Sat: "Item is functioning as intended; no concerns observed.",
  Satisfactory: "Item is functioning as intended; no concerns observed.",
  M: "Item is functional but shows wear; recommend periodic re-inspection.",
  Mon: "Item is functional but shows wear; recommend periodic re-inspection.",
  Monitor: "Item is functional but shows wear; recommend periodic re-inspection.",
  D: "Item is broken, deteriorated, or unsafe; recommend repair or replacement.",
  Defect: "Item is broken, deteriorated, or unsafe; recommend repair or replacement.",
  Defective: "Item is not functioning as intended; repair or replacement is recommended.",
  NI: "Item could not be inspected (inaccessible, unsafe, or excluded).",
  "Not Inspected": "Item could not be inspected (inaccessible, unsafe, or excluded).",
  NP: "Item is not present at this property.",
  "Not Present": "Item is not present at this property.",
  I: "Item was inspected and meets the Standards of Practice.",
  Inspected: "Item was inspected and meets the Standards of Practice.",
  F: "Item visually inspected and observed to be in serviceable, functional condition.",
  Functional: "Item visually inspected and observed to be in serviceable, functional condition.",
  H: "Item presents an immediate safety hazard and should be addressed without delay.",
  Hazardous: "Item presents an immediate safety hazard and should be addressed without delay.",
};

function backfillLevelDescriptions(levels: RatingLevel[]): RatingLevel[] {
  return levels.map((lvl) => {
    if (lvl.description) return lvl;
    const fb =
      FALLBACK_DESCRIPTIONS[lvl.id] ||
      FALLBACK_DESCRIPTIONS[lvl.abbreviation ?? ""] ||
      FALLBACK_DESCRIPTIONS[lvl.label] ||
      "";
    return fb ? { ...lvl, description: fb } : lvl;
  });
}

/* ------------------------------------------------------------------ */
/*  Composite finding key                                              */
/* ------------------------------------------------------------------ */

export function fKey(sectionId: string, itemId: string): string {
  return `_default:${sectionId}:${itemId}`;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export interface UseInspectionOptions {
  inspection: Record<string, unknown>;
  schema: InspectionSchema;
  results: ResultMap;
  ratingLevels?: RatingLevel[];
}

export function useInspectionState(opts: UseInspectionOptions) {
  const [inspection, setInspection] = useState<Inspection>(
    opts.inspection as Inspection,
  );
  const [schema] = useState<InspectionSchema>(opts.schema);
  const sections = schema.sections || [];

  const [ratingLevels, setRatingLevels] = useState<RatingLevel[]>(() =>
    backfillLevelDescriptions(opts.ratingLevels || []),
  );
  const [results, setResults] = useState<ResultMap>(() => {
    // Pre-fill stubs for all items so read paths never hit undefined
    const r = { ...(opts.results || {}) };
    for (const sec of sections) {
      for (const item of sec.items || []) {
        const ck = fKey(sec.id, item.id);
        if (!r[ck]) r[ck] = { rating: null, notes: "", photos: [] };
        if (!r[item.id]) r[item.id] = r[ck];
      }
    }
    return r;
  });

  // Navigation state
  const [currentSectionIdx, setCurrentSectionIdx] = useState(0);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>("items");
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [itemFilter, setItemFilter] = useState<ItemFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [dirty, setDirty] = useState(false);

  // Batch mode
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Record<string, boolean>>(
    {},
  );
  const lastBatchClickedRef = useRef<string | null>(null);

  // Speed mode
  const [speedMode, setSpeedMode] = useState(false);
  const [speedQueue, setSpeedQueue] = useState<number[]>([]);
  const [speedCurrent, setSpeedCurrent] = useState(0);
  const speedItemsRef = useRef<
    Array<{
      id: string;
      label: string;
      sectionName: string;
      sectionIdx: number;
      itemIdx: number;
      rating: string | null;
    }>
  >([]);

  // Comment library
  const [showCommentLibrary, setShowCommentLibrary] = useState(false);
  const [commentLibraryFilter, setCommentLibraryFilter] = useState("all");
  const [commentLibrarySearch, setCommentLibrarySearch] = useState("");
  const [commentLibrarySelectedIdx, setCommentLibrarySelectedIdx] = useState(0);

  // UI panels
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showCheatsheet, setShowCheatsheet] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  const [burstCameraOpen, setBurstCameraOpen] = useState(false);
  const [burstCameraItemId, setBurstCameraItemId] = useState<string | null>(
    null,
  );

  // Section picker (G then S)
  const [sectionPickerOpen, setSectionPickerOpen] = useState(false);
  const [sectionPickerQuery, setSectionPickerQuery] = useState("");
  const [sectionPickerIdx, setSectionPickerIdx] = useState(0);

  // Tags
  const [tagsByItem, setTagsByItem] = useState<
    Record<string, Array<{ id: string; name: string; color?: string }>>
  >({});

  // Published version
  const [publishedVersion, setPublishedVersion] = useState(0);

  // Desktop detection
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true,
  );
  useEffect(() => {
    function onResize() {
      setIsDesktop(window.innerWidth >= 1024);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Derived data                                                     */
  /* ---------------------------------------------------------------- */

  const currentSection = sections[currentSectionIdx] || null;
  const currentSectionItems = currentSection?.items || [];

  const activeItem = useMemo(() => {
    if (!activeItemId) return null;
    return currentSectionItems.find((i) => i.id === activeItemId) || null;
  }, [activeItemId, currentSectionItems]);

  /* ---------------------------------------------------------------- */
  /*  Result helpers                                                   */
  /* ---------------------------------------------------------------- */

  /** Look up the sectionId that owns an itemId */
  const sectionIdForItem = useCallback(
    (itemId: string): string | null => {
      for (const sec of sections) {
        if ((sec.items || []).some((it) => it.id === itemId)) return sec.id;
      }
      return null;
    },
    [sections],
  );

  /** Build a composite finding key for an itemId */
  const fk = useCallback(
    (itemId: string): string => {
      const sid = sectionIdForItem(itemId);
      return sid ? fKey(sid, itemId) : itemId;
    },
    [sectionIdForItem],
  );

  /** Read a result entry with composite-key-first fallback */
  const getResult = useCallback(
    (itemId: string, sectionId?: string): Record<string, unknown> => {
      const sid = sectionId || sectionIdForItem(itemId);
      if (sid) {
        const ck = fKey(sid, itemId);
        if (results[ck]) return results[ck];
      }
      return results[itemId] || {};
    },
    [results, sectionIdForItem],
  );

  /** Find an item by id across all sections */
  const findItemById = useCallback(
    (itemId: string): SchemaItem | null => {
      for (const sec of sections) {
        const found = (sec.items || []).find((it) => it.id === itemId);
        if (found) return found;
      }
      return null;
    },
    [sections],
  );

  /* ---------------------------------------------------------------- */
  /*  Rating helpers                                                   */
  /* ---------------------------------------------------------------- */

  /** Map a ratingLevelId to a bucket: satisfactory | monitor | defect | all */
  const bucketForRatingId = useCallback(
    (ratingId: string | null | undefined): string => {
      if (!ratingId) return "all";
      for (const lvl of ratingLevels) {
        if (lvl.id !== ratingId) continue;
        const nm = (lvl.name || lvl.label || "").toLowerCase();
        const ab = (lvl.abbreviation || "").toUpperCase();
        const id = (lvl.id || "").toUpperCase();
        if (
          nm.includes("sat") ||
          ab === "SAT" ||
          ab === "S" ||
          id === "S"
        )
          return "satisfactory";
        if (
          nm.includes("mon") ||
          nm.includes("marg") ||
          ab === "MON" ||
          ab === "M" ||
          id === "M"
        )
          return "monitor";
        if (
          nm.includes("def") ||
          nm.includes("rep") ||
          ab === "DEF" ||
          ab === "D" ||
          id === "D"
        )
          return "defect";
        break;
      }
      return "all";
    },
    [ratingLevels],
  );

  const getRatingColor = useCallback(
    (ratingId: string | null | undefined): string => {
      if (!ratingId) return "var(--ih-fg-5, #d4d4d8)";
      const lvl = ratingLevels.find((l) => l.id === ratingId);
      if (lvl?.color) return lvl.color;
      const legacy: Record<string, string> = {
        Satisfactory: "var(--ih-status-ok, #10b981)",
        Monitor: "var(--ih-status-watch, #f59e0b)",
        Defect: "var(--ih-status-bad, #ef4444)",
      };
      return legacy[ratingId] || "var(--ih-fg-5, #d4d4d8)";
    },
    [ratingLevels],
  );

  const getRatingLabel = useCallback(
    (ratingId: string | null | undefined): string => {
      if (!ratingId) return "";
      const lvl = ratingLevels.find((l) => l.id === ratingId);
      return lvl?.abbreviation || ratingId;
    },
    [ratingLevels],
  );

  /* ---------------------------------------------------------------- */
  /*  Progress                                                         */
  /* ---------------------------------------------------------------- */

  const progress = useMemo(() => {
    let total = 0;
    let rated = 0;
    for (const sec of sections) {
      for (const item of sec.items || []) {
        total++;
        const r = getResult(item.id, sec.id);
        if (r.rating) {
          rated++;
        } else {
          const v = r.value;
          if (
            v !== undefined &&
            v !== null &&
            v !== "" &&
            !(Array.isArray(v) && v.length === 0)
          ) {
            rated++;
          }
        }
      }
    }
    return {
      total,
      rated,
      pct: total > 0 ? Math.round((rated / total) * 100) : 0,
    };
  }, [sections, getResult]);

  const sectionProgress = useCallback(
    (sectionId: string) => {
      const sec = sections.find((s) => s.id === sectionId);
      if (!sec) return { rated: 0, total: 0, percent: 0 };
      const total = sec.items.length;
      if (total === 0) return { rated: 0, total: 0, percent: 0 };
      let rated = 0;
      for (const item of sec.items) {
        const r = getResult(item.id, sec.id);
        if (r.rating != null) rated++;
      }
      return {
        rated,
        total,
        percent: Math.round((rated / total) * 100),
      };
    },
    [sections, getResult],
  );

  const sectionDefectCount = useCallback(
    (sectionId: string): number => {
      const sec = sections.find((s) => s.id === sectionId);
      if (!sec) return 0;
      let count = 0;
      for (const item of sec.items || []) {
        const rating = getResult(item.id, sectionId)?.rating as string | null;
        if (!rating) continue;
        const level = ratingLevels.find((l) => l.id === rating);
        if (level?.isDefect || rating === "Defect") count++;
      }
      return count;
    },
    [sections, ratingLevels, getResult],
  );

  /** Live report stats */
  const reportStats = useMemo(() => {
    let total = 0;
    let rated = 0;
    let satisfactory = 0;
    let monitor = 0;
    let defect = 0;
    for (const sec of sections) {
      const items = sec.items || [];
      total += items.length;
      for (const item of items) {
        const ratingId = getResult(item.id, sec.id)?.rating as string | null;
        if (!ratingId) continue;
        rated++;
        const bucket = bucketForRatingId(ratingId);
        if (bucket === "satisfactory") satisfactory++;
        else if (bucket === "monitor") monitor++;
        else if (bucket === "defect") defect++;
      }
    }
    return { total, rated, satisfactory, monitor, defect };
  }, [sections, getResult, bucketForRatingId]);

  /* ---------------------------------------------------------------- */
  /*  Navigation                                                       */
  /* ---------------------------------------------------------------- */

  const selectSection = useCallback(
    (idx: number) => {
      setActiveView("items");
      setCurrentSectionIdx(idx);
      setBatchMode(false);
      setBatchSelected({});
      const items = (sections[idx]?.items || []);
      if (items.length > 0) {
        setActiveItemId(items[0].id);
      } else {
        setActiveItemId(null);
      }
    },
    [sections],
  );

  const selectSectionById = useCallback(
    (sectionId: string) => {
      const idx = sections.findIndex((s) => s.id === sectionId);
      if (idx >= 0) selectSection(idx);
    },
    [sections, selectSection],
  );

  const navigateItem = useCallback(
    (dir: 1 | -1) => {
      const items = currentSectionItems;
      if (!items.length) return;
      let curIdx = -1;
      if (activeItemId) {
        curIdx = items.findIndex((i) => i.id === activeItemId);
      }
      const nextIdx = curIdx === -1 ? (dir > 0 ? 0 : items.length - 1) : curIdx + dir;

      if (nextIdx >= items.length) {
        // Wrap to next section
        if (currentSectionIdx < sections.length - 1) {
          const newIdx = currentSectionIdx + 1;
          setCurrentSectionIdx(newIdx);
          const nextItems = sections[newIdx]?.items || [];
          if (nextItems.length) setActiveItemId(nextItems[0].id);
        }
      } else if (nextIdx < 0) {
        // Wrap to prev section
        if (currentSectionIdx > 0) {
          const newIdx = currentSectionIdx - 1;
          setCurrentSectionIdx(newIdx);
          const prevItems = sections[newIdx]?.items || [];
          if (prevItems.length) setActiveItemId(prevItems[prevItems.length - 1].id);
        }
      } else {
        setActiveItemId(items[nextIdx].id);
      }

      // Scroll into view
      requestAnimationFrame(() => {
        if (activeItemId) {
          const card = document.querySelector(`[data-item-id="${activeItemId}"]`);
          card?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    },
    [activeItemId, currentSectionItems, currentSectionIdx, sections],
  );

  const advanceToNextUnrated = useCallback(() => {
    if (!activeItemId) return;
    const items = currentSectionItems;
    const curIdx = items.findIndex((i) => i.id === activeItemId);
    for (let i = curIdx + 1; i < items.length; i++) {
      const r = getResult(items[i].id, currentSection?.id);
      if (!r.rating) {
        setActiveItemId(items[i].id);
        return;
      }
    }
    // No unrated ahead, advance to next
    if (curIdx < items.length - 1) {
      setActiveItemId(items[curIdx + 1].id);
    }
  }, [activeItemId, currentSectionItems, currentSection, getResult]);

  /* ---------------------------------------------------------------- */
  /*  Search                                                           */
  /* ---------------------------------------------------------------- */

  const searchNeedle = useMemo(
    () => (searchQuery || "").trim().toLowerCase(),
    [searchQuery],
  );

  const itemMatchesSearch = useCallback(
    (section: SchemaSection | null, item: SchemaItem): boolean => {
      if (!searchNeedle) return true;
      if (
        section &&
        (section.title || "").toLowerCase().includes(searchNeedle)
      )
        return true;
      if ((item.label || "").toLowerCase().includes(searchNeedle)) return true;
      const r = getResult(item.id);
      if (
        r.notes &&
        String(r.notes).toLowerCase().includes(searchNeedle)
      )
        return true;
      return false;
    },
    [searchNeedle, getResult],
  );

  const sectionMatchesSearch = useCallback(
    (section: SchemaSection): boolean => {
      if (!searchNeedle) return true;
      if ((section.title || "").toLowerCase().includes(searchNeedle))
        return true;
      return (section.items || []).some((it) =>
        itemMatchesSearch(section, it),
      );
    },
    [searchNeedle, itemMatchesSearch],
  );

  /* ---------------------------------------------------------------- */
  /*  Item filter                                                      */
  /* ---------------------------------------------------------------- */

  const itemPassesFilter = useCallback(
    (item: SchemaItem, sectionId?: string): boolean => {
      if (itemFilter === "all") return true;
      const r = getResult(item.id, sectionId);
      if (itemFilter === "unrated") return !r || r.rating == null;
      if (itemFilter === "issues") {
        if (!r || !r.rating) return false;
        const level = ratingLevels.find((l) => l.id === r.rating);
        return (
          !!level?.isDefect ||
          level?.severity === "significant" ||
          level?.severity === "marginal"
        );
      }
      if (itemFilter === "flagged") {
        const tags = tagsByItem[item.id];
        return Array.isArray(tags) && tags.length > 0;
      }
      return true;
    },
    [itemFilter, getResult, ratingLevels, tagsByItem],
  );

  const filterCounts = useMemo(() => {
    const items = currentSectionItems;
    const counts = { all: items.length, unrated: 0, issues: 0, flagged: 0 };
    for (const item of items) {
      const r = getResult(item.id, currentSection?.id);
      if (!r || r.rating == null) counts.unrated++;
      if (r?.rating) {
        const level = ratingLevels.find((l) => l.id === r.rating);
        if (
          level?.isDefect ||
          level?.severity === "significant" ||
          level?.severity === "marginal"
        )
          counts.issues++;
      }
      if (tagsByItem[item.id]?.length) counts.flagged++;
    }
    return counts;
  }, [currentSectionItems, currentSection, getResult, ratingLevels, tagsByItem]);

  /* ---------------------------------------------------------------- */
  /*  Batch                                                            */
  /* ---------------------------------------------------------------- */

  const toggleBatchSelect = useCallback(
    (itemId: string, shiftKey?: boolean) => {
      setBatchSelected((prev) => {
        const next = { ...prev };
        if (shiftKey && lastBatchClickedRef.current) {
          const items = currentSectionItems;
          const startIdx = items.findIndex(
            (i) => i.id === lastBatchClickedRef.current,
          );
          const endIdx = items.findIndex((i) => i.id === itemId);
          if (startIdx >= 0 && endIdx >= 0) {
            const lo = Math.min(startIdx, endIdx);
            const hi = Math.max(startIdx, endIdx);
            for (let i = lo; i <= hi; i++) {
              next[items[i].id] = true;
            }
          }
        } else {
          next[itemId] = !prev[itemId];
        }
        lastBatchClickedRef.current = itemId;
        return next;
      });
    },
    [currentSectionItems],
  );

  const batchSelectAll = useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const item of currentSectionItems) {
      next[item.id] = true;
    }
    setBatchSelected(next);
  }, [currentSectionItems]);

  const selectedBatchCount = useMemo(
    () => Object.values(batchSelected).filter(Boolean).length,
    [batchSelected],
  );

  /* ---------------------------------------------------------------- */
  /*  Section picker                                                   */
  /* ---------------------------------------------------------------- */

  const filteredSectionsForPicker = useMemo(() => {
    const q = (sectionPickerQuery || "").toLowerCase().trim();
    const src = sections.map((s, idx) => ({
      idx,
      title: s.title || s.name || `#${idx}`,
    }));
    if (!q) return src;
    return src.filter((s) => s.title.toLowerCase().includes(q));
  }, [sections, sectionPickerQuery]);

  const openSectionPicker = useCallback(() => {
    setSectionPickerOpen(true);
    setSectionPickerQuery("");
    setSectionPickerIdx(0);
    requestAnimationFrame(() => {
      const input = document.getElementById("section-picker-input");
      input?.focus();
    });
  }, []);

  const closeSectionPicker = useCallback(() => {
    setSectionPickerOpen(false);
    setSectionPickerQuery("");
    setSectionPickerIdx(0);
  }, []);

  const pickSection = useCallback(
    (idx: number) => {
      selectSection(idx);
      closeSectionPicker();
    },
    [selectSection, closeSectionPicker],
  );

  /* ---------------------------------------------------------------- */
  /*  Formatted date                                                   */
  /* ---------------------------------------------------------------- */

  const formattedDate = useMemo(() => {
    const d =
      inspection.date || inspection.scheduledDate || inspection.createdAt;
    if (!d) return "";
    try {
      return new Date(d as string).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return String(d);
    }
  }, [inspection]);

  return {
    // Core data
    inspection,
    setInspection,
    schema,
    sections,
    ratingLevels,
    setRatingLevels,
    results,
    setResults,

    // Navigation
    currentSectionIdx,
    setCurrentSectionIdx,
    currentSection,
    currentSectionItems,
    activeItemId,
    setActiveItemId,
    activeItem,
    activeView,
    setActiveView,
    viewMode,
    setViewMode,
    itemFilter,
    setItemFilter,
    selectSection,
    selectSectionById,
    navigateItem,
    advanceToNextUnrated,

    // Search
    searchQuery,
    setSearchQuery,
    searchNeedle,
    itemMatchesSearch,
    sectionMatchesSearch,

    // Filter
    itemPassesFilter,
    filterCounts,

    // Batch
    batchMode,
    setBatchMode,
    batchSelected,
    setBatchSelected,
    toggleBatchSelect,
    batchSelectAll,
    selectedBatchCount,

    // Speed mode
    speedMode,
    setSpeedMode,
    speedQueue,
    setSpeedQueue,
    speedCurrent,
    setSpeedCurrent,
    speedItemsRef,

    // Comment library
    showCommentLibrary,
    setShowCommentLibrary,
    commentLibraryFilter,
    setCommentLibraryFilter,
    commentLibrarySearch,
    setCommentLibrarySearch,
    commentLibrarySelectedIdx,
    setCommentLibrarySelectedIdx,

    // Section picker
    sectionPickerOpen,
    setSectionPickerOpen,
    sectionPickerQuery,
    setSectionPickerQuery,
    sectionPickerIdx,
    setSectionPickerIdx,
    filteredSectionsForPicker,
    openSectionPicker,
    closeSectionPicker,
    pickSection,

    // UI panels
    showPublishModal,
    setShowPublishModal,
    showCheatsheet,
    setShowCheatsheet,
    settingsOpen,
    setSettingsOpen,
    dockOpen,
    setDockOpen,
    burstCameraOpen,
    setBurstCameraOpen,
    burstCameraItemId,
    setBurstCameraItemId,

    // Tags
    tagsByItem,
    setTagsByItem,

    // Published version
    publishedVersion,
    setPublishedVersion,

    // Save state
    saveStatus,
    setSaveStatus,
    dirty,
    setDirty,

    // Desktop detection
    isDesktop,

    // Result helpers
    getResult,
    findItemById,
    sectionIdForItem,
    fk,
    bucketForRatingId,
    getRatingColor,
    getRatingLabel,

    // Progress
    progress,
    sectionProgress,
    sectionDefectCount,
    reportStats,

    // Misc
    formattedDate,
  };
}
