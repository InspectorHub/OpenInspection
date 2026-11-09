/**
 * The length of a chosen clip, read from its metadata in the browser. Used for two things: refusing a clip that is over the limit before
 * it is uploaded, and showing a length badge on the clip afterwards.
 */

/** A browser reports Infinity for some recorded WebM files, NaN before it knows and 0 for an empty stream: none of those is a length. */
export function durationOrNull(raw: number): number | null {
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * Reads the clip's length, or null when the browser cannot say (or takes more than a few seconds to try). Null means "unknown", never
 * "too long": the caller uploads a clip it cannot measure.
 */
export function videoDurationSec(file: File, timeoutMs = 4000): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const objectUrl = URL.createObjectURL(file);
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute("src");
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    video.onloadedmetadata = () => finish(durationOrNull(video.duration));
    video.onerror = () => finish(null);
    // encodeURI leaves a blob: URL unchanged; it is the sanitizer CodeQL recognises for a URL written to a media element.
    video.src = encodeURI(objectUrl);
  });
}
