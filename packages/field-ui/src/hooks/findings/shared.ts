const DEFAULT_UNIT = "_default";

/** Build a composite key: `unitId:sectionId:itemId` */
export function findingKey(
  unitId: string | null,
  sectionId: string,
  itemId: string,
): string {
  return `${unitId || DEFAULT_UNIT}:${sectionId}:${itemId}`;
}

export type { AttachedRepairItem } from '../../shared/findings-shared';

/* ------------------------------------------------------------------ */
/*  Options                                                            */
/* ------------------------------------------------------------------ */

export interface FindingsOptions {
  sectionIdForItem: (itemId: string) => string | null;
  setDirty: (v: boolean) => void;
  setSaveStatus: (s: "idle" | "saving" | "saved" | "saved-local" | "error") => void;
  inspectionId: string;
  /**
   * #181 — the editor routes every write through the Yjs doc (collab).
   * `synced` is true once the first collab sync step2 from the server has been
   * applied. While the doc exists but `synced` is false, `useFindings` queues
   * doc writes and flushes them after the first sync, so an edit made before
   * the handshake settles lands on the server-seeded structure instead of a
   * locally-seeded subtree the Yjs merge may discard (early-edit race).
   * Omitted means the gate is not wired: writes go live as soon as the doc
   * exists, as before.
   */
  collab?: { doc: import("yjs").Doc; synced?: boolean };
  /**
   * Phase U (Batch C1) — the active per-unit scope. `null`/undefined (default)
   * = the `_default` common scope (identical to pre-Phase-U behavior). When a
   * unit is active, reads resolve `findingKey(activeUnitId, …)` and writes are
   * keyed to that unit, so two units sharing an itemId never collide.
   */
  activeUnitId?: string | null;
}
