/**
 * Media Studio (Plan 4) — single source of truth for which R2 key the report,
 * the Plan-3 photo strip, and the viewer render for a given photo entry.
 *
 * Precedence: annotatedKey || croppedKey || key.
 * Because crop x annotate is SEQUENTIAL — the annotate editor loads the
 * croppedKey as its base, so the annotated PNG already contains the crop —
 * annotatedKey alone is sufficient and supersedes croppedKey.
 */
export interface PhotoCrop {
  aspect: string; // 'free' | a preset like '3:2'
  orientation: 'landscape' | 'portrait';
  x: number; y: number; width: number; height: number;
}
export interface PhotoEntry {
  key: string;
  croppedKey?: string;
  crop?: PhotoCrop;
  annotatedKey?: string;
  annotationsJson?: string;
}

export function resolvePhotoDisplayKey(entry: PhotoEntry): string {
  return entry.annotatedKey || entry.croppedKey || entry.key;
}

/**
 * Re-cropping invalidates any existing annotation (its coords are in the OLD
 * cropped-pixel space). Return a fresh entry with the new crop applied and the
 * annotation fields dropped. Never mutates `entry`; preserves the original key.
 */
export function clearAnnotationOnRecrop(entry: PhotoEntry, croppedKey: string, crop: PhotoCrop): PhotoEntry {
  const { annotatedKey: _a, annotationsJson: _j, ...rest } = entry;
  void _a; void _j;
  return { ...rest, croppedKey, crop };
}
