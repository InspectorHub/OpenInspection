/**
 * Pure helper for batch range-select in the inspection editor.
 * No React dependencies — fully unit-testable.
 */

/**
 * Returns the inclusive slice of `orderedIds` between `fromId` and `toId`,
 * regardless of which comes first. Returns `[]` if either id is absent.
 */
export function rangeIds(orderedIds: string[], fromId: string, toId: string): string[] {
  const i = orderedIds.indexOf(fromId);
  const j = orderedIds.indexOf(toId);
  if (i === -1 || j === -1) return [];
  const [lo, hi] = i <= j ? [i, j] : [j, i];
  return orderedIds.slice(lo, hi + 1);
}
