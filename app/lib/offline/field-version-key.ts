/**
 * field-version-key.ts
 *
 * Maps an offline write intent to the per-field optimistic-concurrency
 * version counter the SERVER keeps for that write, then reads the client's
 * last-known value of that counter out of the result entry.
 *
 * Why this exists: the server stores a monotonic `<field>_v` counter inside
 * `inspection_results.data[itemId]` (see server/lib/field-version.ts) and the
 * GET /results endpoint serializes the whole `data` blob verbatim — so the
 * editor's in-memory ResultMap entry already carries `rating_v`, `notes_v`,
 * etc. When we enqueue an OFFLINE write we must freeze that value so the
 * replay can send a real `expectedVersion` (force:false) instead of the
 * blind force-write the online path uses. Without it, offline replay could
 * never 409 and would silently last-write-wins over concurrent edits — the
 * exact scenario the offline conflict window makes most likely.
 *
 * The version-key mapping MUST mirror InspectionService.patchItem's field
 * remapping (server/services/inspection.service.ts):
 *
 *   intent           PATCH field      stored counter
 *   ─────────────    ────────────     ──────────────
 *   rate             "rating"         rating_v
 *   notes            "notes"          notes_v
 *   toggle-canned    "cannedToggle"   cannedToggle_v
 *   set-defect-fields "defectFields"  → remapped to mutableField "tabs" → tabs_v
 *
 * `save-all` is a whole-blob PATCH /results (not the versioned single-field
 * route) and has no per-field counter — it returns null.
 */

/** The server-side counter key (`<field>_v`) that a given offline intent bumps. */
export function versionKeyForIntent(intent: string): string | null {
  switch (intent) {
    case 'rate':
      return 'rating_v';
    case 'notes':
      return 'notes_v';
    case 'toggle-canned':
      return 'cannedToggle_v';
    case 'set-defect-fields':
      // patchItem remaps field "defectFields" → mutableField "tabs" before the
      // version bump, so the counter lives under tabs_v, not defectFields_v.
      return 'tabs_v';
    default:
      return null;
  }
}

/**
 * Read the client's last-known field version out of a result entry for the
 * given intent. A missing/legacy entry (no `<field>_v`) is version 0 — which
 * is exactly what decideFieldWrite() treats as the initial counter, so a
 * fresh field still gets a real (non-force) check rather than a blind write.
 *
 * Returns null only when the intent has no per-field counter (e.g. save-all).
 */
export function lastKnownVersion(
  entry: Record<string, unknown> | undefined,
  intent: string,
): number | null {
  const key = versionKeyForIntent(intent);
  if (key === null) return null;
  const v = entry?.[key];
  return typeof v === 'number' ? v : 0;
}
