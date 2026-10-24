import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type * as Y from "yjs";
import { setRating as bindingSetRating } from "../collab/results-binding";
import type { SpeedUndo } from "../components/editor/SpeedMode";

/** One entry of the flat list Speed mode walks. */
export interface SpeedItem {
  id: string;
  label: string;
  sectionName: string;
  sectionIdx: number;
  rating: string | null;
}

/** The part of the editor state Speed mode reads and moves. */
export interface SpeedStateSlice {
  speedMode: boolean;
  speedQueue: number[];
  speedCurrent: number;
  speedItemsRef: MutableRefObject<SpeedItem[]>;
  ratingLevels: Array<{ id: string }>;
  setSpeedMode: Dispatch<SetStateAction<boolean>>;
  setSpeedQueue: Dispatch<SetStateAction<number[]>>;
  setSpeedCurrent: Dispatch<SetStateAction<number>>;
  sectionIdForItem: (itemId: string) => string | null;
  setDirty: (dirty: boolean) => void;
}

/** After the last item is rated the overlay stays this long, a little longer than the Undo toast, then closes. */
const SPEED_DONE_LINGER_MS = 3500;

/**
 * Speed mode's rating and Undo. Every write goes through the editor's one `commitRating`.
 *
 * - Rating takes the item out of the queue; the cursor then already points at the next one.
 * - Rating the LAST item leaves the overlay up ("all rated", showing that item) until the toast is gone, so the
 *   last rating can be undone like any other; Undo puts the item back and the overlay carries on.
 * - Undo names the item (the screen has moved on by then) and writes where the rating was made: if the unit
 *   changed in between, the write goes to the recorded unit's finding, not the one now on screen.
 * - A previous value of '' (an old document's cleared rating) is written back as null.
 * - The toast's state is held here, above any layout tree, so it survives a rotation across a breakpoint.
 */
export function useSpeedRating({ state, commitRating, doc, activeUnitId, onUndoUnavailable }: {
  state: SpeedStateSlice;
  commitRating: (sectionId: string, itemId: string, rating: string | null) => void;
  doc: Y.Doc | null;
  activeUnitId: string | null;
  /** Called when an Undo cannot be written (no live document to write the other unit's finding into), so the person is told instead of seeing nothing happen. */
  onUndoUnavailable?: () => void;
}) {
  // The toast outlives the render that rated: what it needs later is read from refs, not from that render's closure.
  const queueRef = useRef(state.speedQueue);
  queueRef.current = state.speedQueue;
  const unitRef = useRef(activeUnitId);
  unitRef.current = activeUnitId;
  const ratedUnit = useRef(new Map<string, string | null>());
  const lastRated = useRef<SpeedItem | null>(null);
  const [pendingUndo, setPendingUndo] = useState<SpeedUndo | null>(null);

  const speedRate = useCallback(
    (levelIdx: number) => {
      if (!state.speedMode) return;
      const qi = state.speedQueue[state.speedCurrent];
      if (qi == null) return;
      const item = state.speedItemsRef.current[qi];
      if (!item || !state.ratingLevels[levelIdx]) return;
      const sid = state.sectionIdForItem(item.id);
      if (sid) commitRating(sid, item.id, state.ratingLevels[levelIdx].id);
      ratedUnit.current.set(item.id, unitRef.current);
      lastRated.current = item;
      // Remove from queue + auto-advance
      const newQueue = [...state.speedQueue];
      newQueue.splice(state.speedCurrent, 1);
      state.setSpeedQueue(newQueue);
      if (newQueue.length > 0 && state.speedCurrent >= newQueue.length) state.setSpeedCurrent(newQueue.length - 1);
    },
    [state, commitRating],
  );

  const undoSpeedRating = useCallback(
    (itemId: string, previous: string | null) => {
      const sid = state.sectionIdForItem(itemId);
      if (!sid) return;
      const restored = previous || null;
      const unit = ratedUnit.current.has(itemId) ? ratedUnit.current.get(itemId) ?? null : unitRef.current;
      if (unit !== unitRef.current) {
        // The unit on screen is not the one this was rated in: write to that unit's finding directly.
        if (doc) {
          bindingSetRating(doc, sid, itemId, restored, unit);
          state.setDirty(true);
        } else {
          onUndoUnavailable?.();
        }
        return;
      }
      commitRating(sid, itemId, restored);
      if (restored) return;
      const flatIdx = state.speedItemsRef.current.findIndex((it) => it.id === itemId);
      if (flatIdx < 0 || queueRef.current.includes(flatIdx)) return;
      const queue = [...queueRef.current, flatIdx].sort((a, b) => a - b);
      state.setSpeedQueue(queue);
      state.setSpeedCurrent(queue.indexOf(flatIdx));
    },
    [state, commitRating, doc, onUndoUnavailable],
  );

  // Everything rated: linger for the toast, then close. An Undo refills the queue, which cancels this.
  const done = state.speedMode && state.speedQueue.length === 0;
  const setSpeedMode = state.setSpeedMode;
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setSpeedMode(false), SPEED_DONE_LINGER_MS);
    return () => clearTimeout(t);
  }, [done, setSpeedMode]);
  useEffect(() => {
    if (!state.speedMode) setPendingUndo(null);
  }, [state.speedMode]);

  return { speedRate, undoSpeedRating, finishedItem: done ? lastRated.current : null, pendingUndo, setPendingUndo };
}
