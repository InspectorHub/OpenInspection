/** What the host needs to address a video's poster: a Stream clip by uid, an R2 clip by media id. */
export interface StripVideoRef {
  provider?: "stream" | "r2" | undefined;
  streamUid?: string | undefined;
  mediaId?: string | undefined;
  posterPct?: number | undefined;
}

/** A video entry as the strip sees it. */
interface StripVideoLike {
  mediaType?: "photo" | "video";
  provider?: "stream" | "r2";
  streamUid?: string;
  mediaId?: string;
}

/** A video this strip can draw: a Stream clip with a uid, or an R2 clip with a media id. */
export function isDrawableVideo(p: StripVideoLike): boolean {
  if (p.mediaType !== "video") return false;
  return p.provider === "r2" ? !!p.mediaId : !!p.streamUid || (!p.provider && !!p.mediaId);
}

/** Format a duration in seconds as m:ss (e.g. 75 → "1:15"). */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
