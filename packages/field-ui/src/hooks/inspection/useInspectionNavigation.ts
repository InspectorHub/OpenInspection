import { useCallback } from "react";
import type { InspectionContext } from "./helpers";

/**
 * Navigation slice: section selection + item traversal (`navigateItem`,
 * `advanceToNextUnrated`). Reads the derived `currentSection` /
 * `currentSectionItems` / `currentSectionIdx` computed once in Core via `ctx`,
 * so the nav math never diverges from the rendered state. Same callback deps as
 * the original monolithic hook.
 */
export function useInspectionNavigation(ctx: InspectionContext) {
  const {
    sections,
    currentSection,
    currentSectionItems,
    currentSectionIdx,
    setCurrentSectionIdx,
    activeItemId,
    setActiveItemId,
    setActiveView,
    setBatchMode,
    setBatchSelected,
    getResult,
  } = ctx;

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

  const advanceToNextUnrated = useCallback((
    onCrossedSection?: (newSectionTitle: string) => void,
  ) => {
    if (!activeItemId || !currentSection) return;
    const sIdx = sections.findIndex((s) => s.id === currentSection.id);
    if (sIdx < 0) return;
    const fromIdx = currentSectionItems.findIndex((i) => i.id === activeItemId);
    for (let i = fromIdx + 1; i < currentSectionItems.length; i++) {
      const r = getResult(currentSectionItems[i].id, currentSection.id);
      if (!r.rating) {
        setActiveItemId(currentSectionItems[i].id);
        return;
      }
    }
    for (let s = sIdx + 1; s < sections.length; s++) {
      const sec = sections[s];
      const items = sec.items as Array<{ id: string }>;
      for (const it of items) {
        const r = getResult(it.id, sec.id);
        if (!r.rating) {
          selectSectionById(sec.id);
          setActiveItemId(it.id);
          onCrossedSection?.(sec.title);
          return;
        }
      }
    }
    // Nothing unrated — stay put.
  }, [activeItemId, currentSectionItems, currentSection, sections, getResult, selectSectionById]);

  return {
    selectSection,
    selectSectionById,
    navigateItem,
    advanceToNextUnrated,
  };
}
