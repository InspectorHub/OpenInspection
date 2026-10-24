/**
 * How many items are still unrated, counted the way Speed mode builds its queue (an item is unrated when its
 * result carries no rating) but as a bare number: no list of every item is built. The touch layouts show the
 * count on their Speed entry points, and it is recomputed whenever the results change, which is every keystroke
 * in a note.
 */
export function countUnratedItems(
  sections: ReadonlyArray<{ id: string; items: ReadonlyArray<{ id: string }> }>,
  getResult: (itemId: string, sectionId?: string) => Record<string, unknown> | undefined,
): number {
  let unrated = 0;
  for (const section of sections) {
    for (const item of section.items) {
      if (!getResult(item.id, section.id)?.rating) unrated += 1;
    }
  }
  return unrated;
}
