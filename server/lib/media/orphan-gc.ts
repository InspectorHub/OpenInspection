/** Orphaned R2 objects are reaped only after this much time unreferenced. */
export const ORPHAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface OrphanPlan {
  toRecord: string[];
  toDelete: string[];
  toClear: string[];
}

/**
 * Pure: classify the R2 keys under one inspection prefix against the live key set
 * and the bookkeeping rows of previously-seen orphans.
 *
 *  - in r2, not live, not yet seen          -> toRecord (first time unreferenced)
 *  - in r2, not live, seen past grace        -> toDelete
 *  - in r2, not live, seen within grace      -> pending (neither)
 *  - has a seen row but live again / gone     -> toClear (drop the bookkeeping row)
 */
export function computeOrphans(
  liveKeys: Set<string>,
  r2Keys: string[],
  seen: Map<string, number>,
  now: number,
  graceMs: number,
): OrphanPlan {
  const toRecord: string[] = [];
  const toDelete: string[] = [];
  const r2Set = new Set(r2Keys);
  for (const key of r2Keys) {
    if (liveKeys.has(key)) continue;
    const firstSeen = seen.get(key);
    if (firstSeen == null) toRecord.push(key);
    else if (now - firstSeen >= graceMs) toDelete.push(key);
  }
  const toClear: string[] = [];
  for (const key of seen.keys()) {
    if (liveKeys.has(key) || !r2Set.has(key)) toClear.push(key);
  }
  return { toRecord, toDelete, toClear };
}
