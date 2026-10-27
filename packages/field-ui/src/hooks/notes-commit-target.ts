/**
 * Where a notes commit goes. A draft carries the item it was typed into, so it is written to THAT item, in that item's own
 * section: the open item or the open section may be different by the time it is committed. If that item (or its section) is
 * gone, the commit is dropped, never redirected to whatever is open. Only a commit that names no item (the open one) takes
 * the active item and the open section.
 */
export function notesCommitTarget(input: {
  itemId: string | undefined;
  activeItemId: string | null;
  currentSectionId: string | undefined;
  sectionIdForItem: (itemId: string) => string | null | undefined;
}): { sectionId: string; itemId: string } | null {
  const itemId = input.itemId ?? input.activeItemId;
  const sectionId = input.itemId ? input.sectionIdForItem(input.itemId) : input.currentSectionId;
  return itemId && sectionId ? { sectionId, itemId } : null;
}
