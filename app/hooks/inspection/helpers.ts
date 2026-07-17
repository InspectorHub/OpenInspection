import type {
  RatingLevel,
  Inspection,
  InspectionSchema,
  SchemaSection,
  SchemaItem,
  ResultMap,
  ActiveView,
  ViewMode,
  ItemFilter,
  SaveStatus,
} from "../useInspection";
import { fKey } from "../useInspection";
import type { Severity } from "~/lib/severity";
import { m } from "~/paraglide/messages";

/**
 * Pure helpers + shared context type for the composed `useInspectionState`
 * sub-hooks. Behavior-preserving decomposition (Phase 4): the master editor
 * hook owns all state in the Core slice and threads a single `ctx` object
 * (plain object, no React Context provider) into the Progress / Navigation /
 * Search / Batch slices. Every derived nav value (`currentSectionIdx`,
 * `currentSectionItems`, memos) is computed once in Core and passed down via
 * `ctx`, so the slices never recompute or diverge.
 */

/* ------------------------------------------------------------------ */
/*  Fallback rating level descriptions                                 */
/* ------------------------------------------------------------------ */

// Built at call time (never frozen at import) so each description resolves the
// active locale through the paraglide message functions.
function fallbackDescriptions(): Record<string, string> {
  return {
    S: m.helper_rating_desc_satisfactory(),
    Sat: m.helper_rating_desc_satisfactory(),
    Satisfactory: m.helper_rating_desc_satisfactory(),
    M: m.helper_rating_desc_monitor(),
    Mon: m.helper_rating_desc_monitor(),
    Monitor: m.helper_rating_desc_monitor(),
    D: m.helper_rating_desc_defect(),
    Defect: m.helper_rating_desc_defect(),
    Defective: m.helper_rating_desc_defective(),
    NI: m.helper_rating_desc_not_inspected(),
    "Not Inspected": m.helper_rating_desc_not_inspected(),
    NP: m.helper_rating_desc_not_present(),
    "Not Present": m.helper_rating_desc_not_present(),
    I: m.helper_rating_desc_inspected(),
    Inspected: m.helper_rating_desc_inspected(),
    F: m.helper_rating_desc_functional(),
    Functional: m.helper_rating_desc_functional(),
    H: m.helper_rating_desc_hazardous(),
    Hazardous: m.helper_rating_desc_hazardous(),
  };
}

export function backfillLevelDescriptions(levels: RatingLevel[]): RatingLevel[] {
  const descriptions = fallbackDescriptions();
  return levels.map((lvl) => {
    if (lvl.description) return lvl;
    const fb =
      descriptions[lvl.id] ||
      descriptions[lvl.abbreviation ?? ""] ||
      descriptions[lvl.label] ||
      "";
    return fb ? { ...lvl, description: fb } : lvl;
  });
}

/* ------------------------------------------------------------------ */
/*  Shared sub-hook context                                            */
/* ------------------------------------------------------------------ */

/**
 * The state + setters + derived values + helpers shared by every inspection
 * sub-hook. The Core slice owns the live state and threads it here so the
 * Progress / Navigation / Search / Batch slices all see the SAME values
 * (no per-slice state). Derived nav state (`currentSection`,
 * `currentSectionIdx`, `currentSectionItems`) is computed once in Core.
 */
export interface InspectionContext {
  // Core data
  inspection: Inspection;
  schema: InspectionSchema;
  sections: SchemaSection[];
  ratingLevels: RatingLevel[];
  results: ResultMap;

  // Navigation state + setters
  currentSectionIdx: number;
  setCurrentSectionIdx: (v: number) => void;
  currentSection: SchemaSection | null;
  currentSectionItems: SchemaItem[];
  activeItemId: string | null;
  setActiveItemId: (v: string | null) => void;
  setActiveView: (v: ActiveView) => void;

  // Filter / search state
  itemFilter: ItemFilter;
  searchQuery: string;

  // Batch state
  batchSelected: Record<string, boolean>;
  setBatchSelected: (
    fn:
      | Record<string, boolean>
      | ((prev: Record<string, boolean>) => Record<string, boolean>),
  ) => void;
  setBatchMode: (v: boolean) => void;

  // Section picker state
  sectionPickerQuery: string;
  setSectionPickerOpen: (v: boolean) => void;
  setSectionPickerQuery: (v: string) => void;
  setSectionPickerIdx: (v: number) => void;

  // Tags
  tagsByItem: Record<
    string,
    Array<{ id: string; name: string; color?: string }>
  >;

  // Result + rating helpers (computed in Core)
  getResult: (itemId: string, sectionId?: string) => Record<string, unknown>;
  severityForRatingId: (ratingId: string | null | undefined) => Severity | "all";
}

// Re-export shared types/values used by the slices and consumers.
export { fKey };
export type {
  RatingLevel,
  Inspection,
  InspectionSchema,
  SchemaSection,
  SchemaItem,
  ResultMap,
  ActiveView,
  ViewMode,
  ItemFilter,
  SaveStatus,
};
