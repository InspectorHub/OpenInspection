/**
 * Media Studio — flatten the Media Center API ({attached, pool}) into one
 * deduped, labeled photo list for the gallery + cover picker. Dedup by R2 key.
 */
export interface GalleryPhoto {
  key: string;
  url: string;
  label: string;
  itemId?: string;
  photoIndex?: number;
  annotated?: boolean;
  originalKey?: string;
  defectId?: string;
  /** Plan 4 — the baked cropped derivative key, when this photo has one. */
  croppedKey?: string;
  /** Plan 7 — media discriminator. Absent ⇒ treated as 'photo'. */
  mediaType?: "photo" | "video";
  /** Plan 7 — video backend provider. 'stream' = Cloudflare Stream; 'r2' = R2 bucket. */
  provider?: "stream" | "r2";
  /** Plan 7 — Cloudflare Stream UID (Stream videos only). */
  streamUid?: string;
  /** Plan 7 — pool row id / media id (R2 videos: used to build r2-object URLs). */
  mediaId?: string;
  /** Plan 7 — poster timestamp as a fraction of duration (0..1). */
  posterPct?: number;
  /** Plan 7 — video duration in seconds (for the m:ss strip badge). */
  durationSec?: number;
}
export interface MediaApiBody {
  data?: {
    attached?: Array<{
      key: string;
      url: string;
      itemLabel?: string;
      itemId?: string;
      photoIndex?: number;
      annotated?: boolean;
      originalKey?: string;
      defectId?: string;
    }>;
    pool?: Array<{ key: string; url: string }>;
  };
}
export function flattenMedia(body: MediaApiBody | null | undefined): GalleryPhoto[] {
  const out: GalleryPhoto[] = [];
  const seen = new Set<string>();
  for (const a of body?.data?.attached ?? []) {
    if (!a?.key || !a?.url || seen.has(a.key)) continue;
    seen.add(a.key);
    out.push({
      key: a.key,
      url: a.url,
      label: a.itemLabel ?? '',
      itemId: a.itemId,
      photoIndex: a.photoIndex,
      annotated: a.annotated,
      originalKey: a.originalKey,
      defectId: a.defectId,
    });
  }
  for (const p of body?.data?.pool ?? []) {
    if (!p?.key || !p?.url || seen.has(p.key)) continue;
    seen.add(p.key);
    out.push({ key: p.key, url: p.url, label: 'Unattached' });
  }
  return out;
}
