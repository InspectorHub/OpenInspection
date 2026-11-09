import type { PhotoSize } from '../../field-urls';

/** The part of a photo entry the studio reads: both the results document's entries and the editor's own view of them fit. */
export interface StudioPhotoEntry {
  key: string;
  croppedKey?: string;
  annotatedKey?: string;
  mediaType?: 'photo' | 'video';
  pendingUpload?: boolean;
}

/** Which item (and section) a studio saves its annotation onto. `sectionId` undefined: the item's own section. */
export interface PhotoStudioItem {
  itemId: string;
  sectionId: string | undefined;
  /** The entry's own key. The save finds the photo again by it, so a list that changed meanwhile cannot redirect the write. */
  originalKey: string | undefined;
}

export interface PhotoStudioTarget {
  url: string | null;
  /** The key the gallery shows for this photo: annotatedKey || croppedKey || key. */
  key: string | null;
  /** The entry's own `key` (what a save addresses it by), whatever it shows. */
  originalKey: string | null;
  /**
   * 0-based position of the photo in the item's photos array (the same convention as the gallery's `photoIndex`).
   * The studio saves its annotation onto `photos[index]`, so this is never a position among photos only:
   * clips occupy array slots too. 0 when nothing opens (then `url` is null and nothing can be saved).
   */
  index: number;
  /** Length of the item's photos array (clips included), 0 when nothing opens. */
  total: number;
}

const EMPTY: PhotoStudioTarget = { url: null, key: null, originalKey: null, index: 0, total: 0 };

/** The keys of an entry the studio can open, or null. Entries are objects; a bare string is an older stored shape. */
function openableKeys(entry: StudioPhotoEntry | string | undefined): { displayKey: string; baseKey: string } | null {
  if (typeof entry === 'string') return entry ? { displayKey: entry, baseKey: entry } : null;
  if (!entry || entry.mediaType === 'video' || entry.pendingUpload || !entry.key) return null;
  return {
    displayKey: entry.annotatedKey || entry.croppedKey || entry.key,
    // Annotate on top of the crop, never on top of an existing annotation (it would be baked in twice).
    baseKey: entry.croppedKey || entry.key,
  };
}

/**
 * What the photo studio opens for the photo at `index` of an item's photos array, addressed by key string.
 * `photos` holds entries (objects), so the entry itself must never be handed to the URL builder: that
 * produced `?key=[object Object]` and a studio that could not load its photo.
 */
export function photoStudioTargetAt(
  photos: ReadonlyArray<StudioPhotoEntry | string> | undefined,
  index: number,
  inspectionId: string,
  photoUrl: (inspectionId: string, key: string, size?: PhotoSize) => string,
  /** The original key the caller believes is at `index`; a different entry there means the results moved on, so nothing opens. */
  expectOriginalKey?: string,
): PhotoStudioTarget {
  const list = photos ?? [];
  const at = Number.isInteger(index) && index >= 0 ? list[index] : undefined;
  const keys = openableKeys(at);
  if (!keys) return EMPTY;
  if (expectOriginalKey && (typeof at === 'string' ? at : at?.key) !== expectOriginalKey) return EMPTY;
  return { url: photoUrl(inspectionId, keys.baseKey, 'original'), key: keys.displayKey, originalKey: typeof at === 'string' ? at : at?.key ?? null, index, total: list.length };
}

/**
 * Where a dialog's photo is NOW. A dialog opened on a photo remembers its key as well as its index; the list may have
 * changed since (another device inserted, deleted or reordered), so the entry with that key wins. Gone: -1, which
 * addresses nothing. Without a remembered key the index stands.
 */
export function resolvePhotoIndex(
  photos: ReadonlyArray<StudioPhotoEntry | string>,
  remembered: { photoIndex: number; originalKey?: string | undefined },
): number {
  if (!remembered.originalKey) return remembered.photoIndex;
  return photos.findIndex((p) => (typeof p === 'string' ? p : p?.key) === remembered.originalKey);
}

/** The studio's toolbar entry: the item's first photo (skipping clips and photos not yet uploaded). */
export function photoStudioTarget(
  photos: ReadonlyArray<StudioPhotoEntry | string> | undefined,
  inspectionId: string,
  photoUrl: (inspectionId: string, key: string, size?: PhotoSize) => string,
): PhotoStudioTarget {
  const list = photos ?? [];
  const first = list.findIndex((entry) => openableKeys(entry) !== null);
  return first < 0 ? EMPTY : photoStudioTargetAt(list, first, inspectionId, photoUrl);
}
