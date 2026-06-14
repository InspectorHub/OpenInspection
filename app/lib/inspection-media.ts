/**
 * Image Studio — flatten the Media Center API ({attached, pool}) into one
 * deduped, labeled photo list for the gallery + cover picker. Dedup by R2 key.
 */
export interface GalleryPhoto { key: string; url: string; label: string }
export interface MediaApiBody {
  data?: {
    attached?: Array<{ key: string; url: string; itemLabel?: string }>;
    pool?: Array<{ key: string; url: string }>;
  };
}
export function flattenMedia(body: MediaApiBody | null | undefined): GalleryPhoto[] {
  const out: GalleryPhoto[] = [];
  const seen = new Set<string>();
  const push = (key?: string, url?: string, label = '') => {
    if (!key || !url || seen.has(key)) return;
    seen.add(key);
    out.push({ key, url, label });
  };
  for (const a of body?.data?.attached ?? []) push(a?.key, a?.url, a?.itemLabel ?? '');
  for (const p of body?.data?.pool ?? []) push(p?.key, p?.url, 'Unattached');
  return out;
}
