/**
 * Reorders an item within a section by repeatedly applying a neighbor-swap
 * `moveItem(sectionId, itemId, dir)` primitive — used where no move-to-index
 * structural op exists (see structure-ops.ts). Computes the index delta
 * between `fromId` and `toId` in the given (unfiltered) item list and
 * replays the swap that many steps in the resolved direction.
 *
 * Pure aside from the injected `moveItem` callback, which is expected to
 * apply synchronously (advancing its own snapshot ref) so chained calls
 * compose correctly within a single synchronous loop.
 */
export function reorderItemBySwap(
  items: Array<{ id: string }>,
  fromId: string,
  toId: string,
  sectionId: string,
  moveItem: (sectionId: string, itemId: string, dir: -1 | 1) => void,
): void {
  const fromIdx = items.findIndex((i) => i.id === fromId);
  const toIdx = items.findIndex((i) => i.id === toId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
  const dir: -1 | 1 = toIdx > fromIdx ? 1 : -1;
  const steps = Math.abs(toIdx - fromIdx);
  for (let i = 0; i < steps; i++) moveItem(sectionId, fromId, dir);
}
