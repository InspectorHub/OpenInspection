import type { GalleryPhoto } from './inspection-media';

interface LiveEntry {
  key: string;
  croppedKey?: string;
  annotatedKey?: string;
}

/** The same address with its `key` parameter replaced; an address without one is left as it is. */
function withKey(url: string, key: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const params = new URLSearchParams(url.slice(q + 1));
  if (!params.has('key')) return url;
  params.set('key', key);
  return `${url.slice(0, q)}?${params.toString()}`;
}

/**
 * The photos drawer lists what the SERVER has, and the server can be behind the editor (under collaborative editing the
 * results are written late), so right after a crop or an annotation a row still named the previous file. This shows the
 * row as the editor has it now: the entry at the row's index, if it is still the photo the row names, with the key and
 * image it shows. A row that cannot be matched (a loose pool photo, a defect's photo, a changed list) is returned as it is.
 */
export function liveGalleryRow(row: GalleryPhoto, entries: ReadonlyArray<LiveEntry | string>): GalleryPhoto {
  if (!row.itemId || row.photoIndex == null || row.defectId) return row;
  const entry = entries[row.photoIndex];
  if (!entry || typeof entry === 'string' || entry.key !== row.originalKey) return row;
  const key = entry.annotatedKey || entry.croppedKey || entry.key;
  if (key === row.key) return row;
  const live: GalleryPhoto = { ...row, key, url: withKey(row.url, key), annotated: !!entry.annotatedKey };
  if (entry.croppedKey) live.croppedKey = entry.croppedKey; else delete live.croppedKey;
  return live;
}
