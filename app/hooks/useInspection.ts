import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { backfillLevelDescriptions } from "./inspection/helpers";
import type { InspectionContext } from "./inspection/helpers";
import type { Severity } from "~/lib/severity";
import { rangeIds } from "~/lib/editor/batch-range";
import { useInspectionProgress } from "./inspection/useInspectionProgress";
import { useInspectionNavigation } from "./inspection/useInspectionNavigation";
import { useInspectionSearch } from "./inspection/useInspectionSearch";
import { useInspectionBatch } from "./inspection/useInspectionBatch";

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
  pausesAdvance?: boolean;
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

/**
 * The master inspection-editor state hook. Behavior-preserving decomposition
 * (Phase 4): this function OWNS all of the core state (useState/useRef/useEffect),
 * the derived nav values, and the result/rating helpers, then threads a single
 * shared `ctx` object (plain object — NO React Context provider) into the
 * composed Progress / Navigation / Search / Batch sub-hooks under
 * ./inspection/*. Each slice returns its methods/values; this hook assembles them
 * into the (unchanged) return object — same keys, order, and signatures as
 * before.
 *
 * The derived nav state (`currentSection` / `currentSectionItems` /
 * `currentSectionIdx`) is computed ONCE here and passed through `ctx`, so every
 * slice that branches on the current section reads the SAME values (no
 * recomputation, no divergence). Hook call order is fixed and unconditional;
 * every memo/callback dependency array is identical to the pre-split hook.
 */
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
  const [itemFullscreen, setItemFullscreen] = useState(false);
  const [sideRailCollapsed, setSideRailCollapsed] = useState(false);
  const [itemFilter, setItemFilter] = useState<ItemFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [dirty, setDirty] = useState(false);

  // Batch mode
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Record<string, boolean>>(
    {},
  );

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

  /** Read the severity of a rating level by id (structured — no name guessing). */
  const severityForRatingId = useCallback(
    (ratingId: string | null | undefined): Severity | "all" => {
      if (!ratingId) return "all";
      const lvl = ratingLevels.find((l) => l.id === ratingId);
      return (lvl?.severity as Severity | undefined) ?? "all";
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
  /*  Shared context for the composed slices                           */
  /* ---------------------------------------------------------------- */

  // Single shared context: every slice sees the SAME live state + setters +
  // derived nav values + helpers. The nav values (`currentSection` /
  // `currentSectionItems` / `currentSectionIdx`) are computed once above and
  // passed through here so the slices never recompute or diverge.
  const ctx: InspectionContext = {
    inspection,
    schema,
    sections,
    ratingLevels,
    results,
    currentSectionIdx,
    setCurrentSectionIdx,
    currentSection,
    currentSectionItems,
    activeItemId,
    setActiveItemId,
    setActiveView,
    itemFilter,
    searchQuery,
    batchSelected,
    setBatchSelected,
    setBatchMode,
    sectionPickerQuery,
    setSectionPickerOpen,
    setSectionPickerQuery,
    setSectionPickerIdx,
    tagsByItem,
    getResult,
    severityForRatingId,
  };

  /* ---------------------------------------------------------------- */
  /*  Composed slices                                                  */
  /* ---------------------------------------------------------------- */

  const {
    progress,
    sectionProgress,
    sectionDefectCount,
    reportStats,
    overallStats,
  } = useInspectionProgress(ctx);

  const { selectSection, selectSectionById, navigateItem, advanceToNextUnrated } =
    useInspectionNavigation(ctx);

  const {
    searchNeedle,
    itemMatchesSearch,
    sectionMatchesSearch,
    itemPassesFilter,
    filterCounts,
  } = useInspectionSearch(ctx);

  const {
    toggleBatchSelect,
    batchSelectAll,
    selectedBatchCount,
    filteredSectionsForPicker,
    openSectionPicker,
    closeSectionPicker,
    pickSection,
  } = useInspectionBatch(ctx, selectSection);

  /** Merge every item in the inclusive range [fromId, toId] into batchSelected. */
  const batchSelectRange = useCallback((fromId: string, toId: string) => {
    const ids = rangeIds(currentSectionItems.map(it => it.id), fromId, toId);
    if (ids.length === 0) return;
    setBatchSelected(prev => { const next = { ...prev }; for (const id of ids) next[id] = true; return next; });
  }, [currentSectionItems]);

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
    itemFullscreen,
    setItemFullscreen,
    sideRailCollapsed,
    setSideRailCollapsed,
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
    batchSelectRange,
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
    severityForRatingId,
    getRatingColor,
    getRatingLabel,

    // Progress
    progress,
    sectionProgress,
    sectionDefectCount,
    reportStats,
    overallStats,

    // Misc
    formattedDate,
  };
}
