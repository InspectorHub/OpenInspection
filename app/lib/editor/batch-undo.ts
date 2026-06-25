/**
 * Pure helper for batch-rating undo in the inspection editor.
 * No React dependencies — fully unit-testable.
 */

/**
 * Captures the current rating (or null for unrated) for each item id,
 * using the caller-supplied `readRating` accessor. Call this BEFORE
 * applying the batch write so the snapshot reflects the prior state.
 */
export function capturePriorRatings(
  itemIds: string[],
  readRating: (itemId: string) => string | null,
): Array<{ itemId: string; prior: string | null }> {
  return itemIds.map((itemId) => ({ itemId, prior: readRating(itemId) }));
}
