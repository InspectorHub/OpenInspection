import type { PhotoEntry } from './collect-attached';

/**
 * Reorder photos[] to match `order` (by key). The key multiset of the keyed photos must be identical. A video entry has no key, so it
 * is not part of the order: it keeps the position it has, and the photos are permuted among the other positions.
 */
export function applyReorder(photos: PhotoEntry[], order: string[]): PhotoEntry[] {
  if (order.some(k => !k)) throw new Error('order names an entry that is not a photo key');
  const keyed = photos.filter(p => p.key);
  const have = keyed.map(p => p.key).sort();
  const want = order.slice().sort();
  if (have.length !== want.length || have.some((k, i) => k !== want[i])) {
    // A name that is no photo's key and looks like a clip or pending reference gets the clearer answer; a real key is never read as one.
    const haveSet = new Set(have);
    throw new Error(order.some(k => !haveSet.has(k) && /^[msp]:/.test(k))
      ? 'order names an entry that is not a photo key'
      : 'photo order mismatch — reorder cannot add or drop photos');
  }
  const byKey = new Map(keyed.map(p => [p.key, p]));
  const next = order.map(k => byKey.get(k)!);
  let at = 0;
  return photos.map(p => (p.key ? next[at++] : p));
}

/** Remove one entry by index (detach). Returns the new array (does not touch R2). */
export function applyDetach(photos: PhotoEntry[], index: number): PhotoEntry[] {
  if (index < 0 || index >= photos.length) throw new Error('photo index out of range');
  return photos.filter((_, i) => i !== index);
}

/** Revert one entry to its original: drop derivatives (annotatedKey/annotationsJson). */
export function applyRevert(photos: PhotoEntry[], index: number): PhotoEntry[] {
  if (index < 0 || index >= photos.length) throw new Error('photo index out of range');
  if (photos[index]?.mediaType === 'video') throw new Error('a video has no edits to revert');
  return photos.map((p, i) => (i === index ? { key: p.key } : p));
}

/** Move one entry (with all its derivatives) from `from[index]` to the end of `to`. */
export function moveEntry(
  from: PhotoEntry[],
  to: PhotoEntry[],
  index: number,
): { from: PhotoEntry[]; to: PhotoEntry[] } {
  if (index < 0 || index >= from.length) throw new Error('photo index out of range');
  const moved = from[index];
  return {
    from: from.filter((_, i) => i !== index),
    to: [...to, moved],
  };
}
