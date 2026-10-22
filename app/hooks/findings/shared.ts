import type { useFetcher } from "react-router";

const DEFAULT_UNIT = "_default";

/** Build a composite key: `unitId:sectionId:itemId` */
export function findingKey(
  unitId: string | null,
  sectionId: string,
  itemId: string,
): string {
  return `${unitId || DEFAULT_UNIT}:${sectionId}:${itemId}`;
}

export type { AttachedRepairItem } from '@core/field-ui/shared/findings-shared';

/* ------------------------------------------------------------------ */
/*  Options                                                            */
/* ------------------------------------------------------------------ */

export interface FindingsOptions {
  sectionIdForItem: (itemId: string) => string | null;
  setDirty: (v: boolean) => void;
  setSaveStatus: (s: "idle" | "saving" | "saved" | "error") => void;
  inspectionId: string;
  /**
   * Notes commit (textarea blur) and the next mutation (rating click) fire in
   * the same gesture. On a shared fetcher, React Router aborts the in-flight
   * notes submission when the rating submits — the note is lost. Callers pass a
   * dedicated fetcher for notes commits.
   */
  notesFetcher?: ReturnType<typeof useFetcher>;
  /** #181 — the editor routes every write through the Yjs doc (collab). */
  collab?: { doc: import("yjs").Doc };
  /**
   * Phase U (Batch C1) — the active per-unit scope. `null`/undefined (default)
   * = the `_default` common scope (identical to pre-Phase-U behavior). When a
   * unit is active, reads resolve `findingKey(activeUnitId, …)` and writes are
   * keyed to that unit, so two units sharing an itemId never collide.
   */
  activeUnitId?: string | null;
}
