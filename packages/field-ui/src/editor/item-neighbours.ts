/**
 * Moving from one item to the next or the previous one across the whole inspection: past the last item of a section it
 * enters the next section, before the first item it enters the previous one, and a section with no items is passed over.
 */
export interface NavSection {
  id: string;
  items?: ReadonlyArray<{ id: string }>;
}

/** Whether the list shows this item (the filter chips and the search): Previous / Next walk what the list shows, not what it hides. */
export type ItemVisible = (section: NavSection, item: { id: string }) => boolean;

interface ItemStop {
  sectionId: string;
  itemId: string;
}

export interface ItemNeighbours {
  prev: ItemStop | null;
  next: ItemStop | null;
  /** 1-based place of the item among the items of its own section, and how many that section holds. */
  position: { index: number; total: number } | null;
}

export function itemNeighbours(sections: ReadonlyArray<NavSection>, sectionId: string | undefined, itemId: string | null, isVisible?: ItemVisible): ItemNeighbours {
  const stops: ItemStop[] = [];
  for (const section of sections) {
    for (const item of section.items ?? []) {
      // The open item is always a stop, even when a filter hides it: that is where the walk starts from.
      if (isVisible && item.id !== itemId && !isVisible(section, item)) continue;
      stops.push({ sectionId: section.id, itemId: item.id });
    }
  }
  const at = itemId === null ? -1 : stops.findIndex((stop) => stop.itemId === itemId && (sectionId === undefined || stop.sectionId === sectionId));
  const here = at < 0 ? undefined : stops[at];
  if (here === undefined) return { prev: null, next: null, position: null };
  const own = stops.filter((stop) => stop.sectionId === here.sectionId);
  return {
    prev: stops[at - 1] ?? null,
    next: stops[at + 1] ?? null,
    position: { index: own.findIndex((stop) => stop.itemId === itemId) + 1, total: own.length },
  };
}
