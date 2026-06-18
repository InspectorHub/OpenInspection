import type { PhotoEntry } from './collect-attached';

/** Reorder photos[] to match `order` (by key). The key multiset must be identical. */
export function applyReorder(photos: PhotoEntry[], order: string[]): PhotoEntry[] {
  const have = photos.map(p => p.key).slice().sort();
  const want = order.slice().sort();
  if (have.length !== want.length || have.some((k, i) => k !== want[i])) {
    throw new Error('photo order mismatch — reorder cannot add or drop photos');
  }
  const byKey = new Map(photos.map(p => [p.key, p]));
  return order.map(k => byKey.get(k)!);
}

/** Remove one entry by index (detach). Returns the new array (does not touch R2). */
export function applyDetach(photos: PhotoEntry[], index: number): PhotoEntry[] {
  if (index < 0 || index >= photos.length) throw new Error('photo index out of range');
  return photos.filter((_, i) => i !== index);
}

/** Revert one entry to its original: drop derivatives (annotatedKey/annotationsJson). */
export function applyRevert(photos: PhotoEntry[], index: number): PhotoEntry[] {
  if (index < 0 || index >= photos.length) throw new Error('photo index out of range');
  return photos.map((p, i) => (i === index ? { key: p.key } : p));
}
