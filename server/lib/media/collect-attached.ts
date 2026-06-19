export interface PhotoEntry {
  key: string;
  croppedKey?: string;
  crop?: { aspect: string; orientation: 'landscape' | 'portrait'; x: number; y: number; width: number; height: number };
  annotatedKey?: string;
  annotationsJson?: string;
}
export interface AttachedPhoto {
  key: string;          // displayKey = annotatedKey || croppedKey || key (what the report/grid shows)
  originalKey: string;  // the source key (revert target)
  url: string;
  itemId: string;
  itemLabel: string;
  sectionId: string;
  sectionTitle: string;
  photoIndex: number;   // index within its own photos[] array
  annotated: boolean;
  defectId?: string;    // present when the photo hangs off a defect, not the item
}
export interface ItemMeta { itemLabel: string; sectionId: string; sectionTitle: string }

interface DefectLike { id?: string; photos?: PhotoEntry[] }
interface ResultEntry {
  photos?: PhotoEntry[];
  tabs?: { defects?: Record<string, DefectLike> };
  customComments?: { defects?: DefectLike[] };
}

/** Pure: flatten one inspection_results.data map into attached photos.
 *  parseKey resolves a composite finding-key back to its itemId. */
export function collectAttachedPhotos(
  data: Record<string, ResultEntry>,
  itemMeta: Map<string, ItemMeta>,
  makeUrl: (key: string) => string,
  parseKey: (key: string) => { itemId: string; sectionId?: string } = (k) => ({ itemId: k }),
): AttachedPhoto[] {
  const out: AttachedPhoto[] = [];
  const push = (itemId: string, sectionFallback: string | undefined, p: PhotoEntry | null, idx: number, defectId?: string) => {
    if (!p || typeof p.key !== 'string') return;
    const meta = itemMeta.get(itemId) ?? { itemLabel: itemId, sectionId: sectionFallback || 'unknown', sectionTitle: 'Unsectioned' };
    const displayKey = p.annotatedKey || p.croppedKey || p.key;
    const attached: AttachedPhoto = {
      key: displayKey, originalKey: p.key, url: makeUrl(displayKey),
      itemId, itemLabel: meta.itemLabel, sectionId: meta.sectionId, sectionTitle: meta.sectionTitle,
      photoIndex: idx, annotated: !!p.annotatedKey,
    };
    if (defectId !== undefined) attached.defectId = defectId;
    out.push(attached);
  };
  for (const [key, entry] of Object.entries(data)) {
    const { itemId, sectionId } = parseKey(key);
    (Array.isArray(entry?.photos) ? entry.photos : []).forEach((p, i) => push(itemId, sectionId, p, i));
    const cannedDefects = entry?.tabs?.defects ?? {};
    for (const [defectId, d] of Object.entries(cannedDefects)) {
      (Array.isArray(d?.photos) ? d.photos : []).forEach((p, i) => push(itemId, sectionId, p, i, defectId));
    }
    for (const d of (entry?.customComments?.defects ?? [])) {
      (Array.isArray(d?.photos) ? d.photos : []).forEach((p, i) => push(itemId, sectionId, p, i, d.id));
    }
  }
  return out;
}
