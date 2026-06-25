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

export function backfillLevelDescriptions(levels: RatingLevel[]): RatingLevel[] {
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
  bucketForRatingId: (ratingId: string | null | undefined) => string;
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
