import { useEffect, useRef } from "react";
import Sortable from "sortablejs";

export interface UseSortableReorderOptions {
  /**
   * Ordered ids of the currently-rendered rows, in DOM order. The hook reads
   * this (via a ref) inside the drop handler to translate Sortable's index move
   * into the `(fromId, toId)` contract the structure reducers expect.
   */
  ids: string[];
  /** Move `fromId` to `toId`'s position (matches `reorderSection`/`reorderItem`). */
  onReorder: (fromId: string, toId: string) => void;
  /** When true the list is not draggable (e.g. an inline rename is in progress). */
  disabled?: boolean;
}

/**
 * Shared drag-to-reorder for the section rail and item list, built on the
 * project's existing SortableJS dependency (same convention as ItemPhotoStrip).
 *
 * Interaction model (aligns with Apple HIG / Material / mainstream SaaS):
 * - **Desktop**: grab the `[data-drag-handle]` grip and drag immediately.
 * - **Touch/pad**: touch-and-hold the handle for 500 ms (the OS long-press
 *   baseline) to lift, then drag. `delayOnTouchOnly` keeps the desktop path
 *   immediate; a quick tap or a scroll gesture is preserved because the delay
 *   elapses (or `touchStartThreshold` is exceeded) first, so native vertical
 *   scroll and pinch-zoom are never hijacked.
 * - Dragging is limited to the handle, so a plain tap on a row still
 *   selects/edits it and never accidentally starts a drag.
 *
 * The parent owns the actual move (React state stays the source of truth); the
 * hook only reports `(fromId, toId)`.
 */
export function useSortableReorder<T extends HTMLElement = HTMLDivElement>({ ids, onReorder, disabled = false }: UseSortableReorderOptions) {
  const containerRef = useRef<T | null>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || disabled) return;
    const s = Sortable.create(el, {
      animation: 150,
      delay: 500,
      delayOnTouchOnly: true,
      // Allow a little finger wobble before the long-press is cancelled as a
      // scroll — keeps the gesture forgiving on touch without stealing scroll.
      touchStartThreshold: 8,
      handle: "[data-drag-handle]",
      draggable: "[data-sortable-item]",
      ghostClass: "opacity-40",
      onEnd: (evt) => {
        const { oldIndex, newIndex } = evt;
        if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
        const list = idsRef.current;
        const fromId = list[oldIndex];
        const toId = list[newIndex];
        if (fromId && toId) onReorderRef.current(fromId, toId);
      },
    });
    return () => s.destroy();
  }, [disabled]);

  return { containerRef };
}
