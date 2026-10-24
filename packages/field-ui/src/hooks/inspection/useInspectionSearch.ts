import { useCallback, useMemo } from "react";
import type { InspectionContext, SchemaSection, SchemaItem } from "./helpers";

/**
 * Search + item-filter slice: the normalized search needle, item/section match
 * predicates, the filter predicate, and the per-filter counts for the current
 * section. Same memo/callback deps as the original monolithic hook (the current
 * section + items come from Core via `ctx`).
 */
export function useInspectionSearch(ctx: InspectionContext) {
  const {
    searchQuery,
    itemFilter,
    ratingLevels,
    tagsByItem,
    currentSectionItems,
    currentSection,
    getResult,
  } = ctx;

  /* -------------------------------- search -------------------------------- */

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

  /* -------------------------------- filter -------------------------------- */

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

  return {
    searchNeedle,
    itemMatchesSearch,
    sectionMatchesSearch,
    itemPassesFilter,
    filterCounts,
  };
}
