/**
 * FE-3 — attach uploaded photo keys to the defect that prompted the shot.
 *
 * Canned-defect photos live on the per-defect STATE row
 * (`result.tabs.defects[].photos`) — the shape the report resolver already
 * maps to `defectPhotos`. Custom-defect photos live on
 * `result.customComments.defects[].photos`. Both helpers are immutable so
 * callers can persist the freshly-computed result map via save-all.
 */

interface PhotoRef {
  key: string;
}

interface DefectStateRow {
  cannedId: string;
  included?: boolean;
  photos?: PhotoRef[];
  [k: string]: unknown;
}

interface CustomDefectRow {
  id: string;
  photos?: PhotoRef[];
  [k: string]: unknown;
}

export function attachPhotoToDefectState<T extends Record<string, unknown>>(
  result: T,
  cannedId: string,
  photoKey: string,
): T {
  const tabs = (result.tabs ?? {}) as Record<string, unknown>;
  const rows = (Array.isArray(tabs.defects) ? tabs.defects : []) as DefectStateRow[];
  const idx = rows.findIndex((r) => r.cannedId === cannedId);
  let nextRows: DefectStateRow[];
  if (idx >= 0) {
    const row = rows[idx];
    nextRows = rows.slice();
    nextRows[idx] = { ...row, photos: [...(row.photos ?? []), { key: photoKey }] };
  } else {
    // No state row yet — the inspector is photographing a defect they just
    // ticked (template default). Create the row included so the photo and
    // the inclusion persist together.
    nextRows = [...rows, { cannedId, included: true, photos: [{ key: photoKey }] }];
  }
  return {
    ...result,
    tabs: { ...tabs, defects: nextRows },
  };
}

export function attachPhotoToCustomDefect<T extends Record<string, unknown>>(
  result: T,
  customId: string,
  photoKey: string,
): T {
  const cc = (result.customComments ?? {}) as { defects?: CustomDefectRow[] };
  const rows = cc.defects ?? [];
  if (!rows.some((r) => r.id === customId)) return result;
  return {
    ...result,
    customComments: {
      ...cc,
      defects: rows.map((r) =>
        r.id === customId ? { ...r, photos: [...(r.photos ?? []), { key: photoKey }] } : r,
      ),
    },
  };
}
