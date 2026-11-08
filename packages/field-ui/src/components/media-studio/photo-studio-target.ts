import type { PhotoEntry } from '../../shared/results-doc.types';
import type { PhotoSize } from '../../field-urls';

export interface PhotoStudioTarget {
  url: string | null;
  key: string | null;
  /** 1-based position of the opened photo, 0 when nothing opens. */
  index: number;
  total: number;
}

const EMPTY: PhotoStudioTarget = { url: null, key: null, index: 0, total: 0 };

/** The key of an entry the studio can open, or null. Entries are objects; a bare string is an older stored shape. */
function openableKey(entry: PhotoEntry | string): { key: string; baseKey: string } | null {
  if (typeof entry === 'string') return entry ? { key: entry, baseKey: entry } : null;
  if (!entry || entry.mediaType === 'video' || entry.pendingUpload || !entry.key) return null;
  // Annotate on top of the crop, never on top of an existing annotation (it would be baked in twice).
  return { key: entry.key, baseKey: entry.croppedKey || entry.key };
}

/**
 * What the photo studio opens for an item: its first photo, addressed by key string.
 * `photos` holds entries (objects), so the entry itself must never be handed to the URL builder: that
 * produced `?key=[object Object]` and a studio that could not load its photo.
 */
export function photoStudioTarget(
  photos: ReadonlyArray<PhotoEntry | string> | undefined,
  inspectionId: string,
  photoUrl: (inspectionId: string, key: string, size?: PhotoSize) => string,
): PhotoStudioTarget {
  const openable = (photos ?? []).map(openableKey).filter((e): e is { key: string; baseKey: string } => e !== null);
  const first = openable[0];
  if (!first) return EMPTY;
  return { url: photoUrl(inspectionId, first.baseKey, 'original'), key: first.key, index: 1, total: openable.length };
}
