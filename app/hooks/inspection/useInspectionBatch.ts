import { useCallback, useMemo } from "react";
import type { InspectionContext } from "./helpers";

/**
 * Batch + section-picker slice: multi-select toggles (with shift-range),
 * select-all, the selected count, and the "G then S" section picker
 * (filter/open/close/pick). `pickSection` calls Navigation's `selectSection`,
 * threaded in as `selectSection` so the two slices stay in lockstep without a
 * shared React Context. Same memo/callback deps as the original monolithic hook.
 */
export function useInspectionBatch(
  ctx: InspectionContext,
  selectSection: (idx: number) => void,
) {
  const {
    sections,
    currentSectionItems,
    batchSelected,
    setBatchSelected,
    sectionPickerQuery,
    setSectionPickerOpen,
    setSectionPickerQuery,
    setSectionPickerIdx,
  } = ctx;

  /* -------------------------------- batch --------------------------------- */

  // Single-item toggle. Shift-click range-select is the separate canonical
  // path (`batchSelectRange` / `batch-range.ts`), driven by ItemList's own
  // last-clicked ref — there is intentionally no range branch here.
  const toggleBatchSelect = useCallback(
    (itemId: string) => {
      setBatchSelected((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
    },
    [setBatchSelected],
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

  /* ---------------------------- section picker ---------------------------- */

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

  return {
    toggleBatchSelect,
    batchSelectAll,
    selectedBatchCount,
    filteredSectionsForPicker,
    openSectionPicker,
    closeSectionPicker,
    pickSection,
  };
}
