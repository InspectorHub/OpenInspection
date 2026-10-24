import { useCallback, useEffect, useState } from "react";

/** Stage size used before anything is known about the photo. */
const FALLBACK = { w: 600, h: 400 };

export interface PhotoSource {
  /** The decoded photo at natural resolution. Null while loading, and on failure. */
  image: HTMLImageElement | null;
  /** Natural pixel dimensions of `image`, or the fallback stage size. */
  natural: { w: number; h: number };
  /** natural -> display scale that fits the photo in the viewport. */
  fitScale: number;
  /** The request came back, and it came back a failure. */
  failed: boolean;
  /** Ask for the same photo again. */
  retry: () => void;
}

/**
 * Loads the photo studio's source image.
 *
 * N6 — this was an effect inside `PhotoAnnotator` that set `crossOrigin`,
 * `onload` and `src`, and had no `onerror` anywhere. A URL that 403s, 404s or
 * dies on the network therefore never resolved: `image` stayed null forever and
 * the studio painted a blank canvas with nothing on it to act on.
 *
 * The fix is that a failure is a STATE here, distinct both from "still loading"
 * and from "no photo was selected" — the caller can only say which of the three
 * it is if this hook tells it apart. Same rule the photo drawer landed on in
 * F57: the confident claim is made only on an answer that came back.
 */
export function usePhotoSource(photoUrl: string | null, enabled: boolean): PhotoSource {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number }>(FALLBACK);
  const [fitScale, setFitScale] = useState(1);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    setFailed(false);
    // Drop the previous photo before requesting the next one, so switching
    // photos shows "loading" rather than the one that is being replaced.
    setImage(null);
    if (!photoUrl) {
      setNatural(FALLBACK);
      setFitScale(1);
      return;
    }
    let cancelled = false;
    const img = new window.Image();
    img.crossOrigin = "anonymous"; // allow toBlob export of cross-origin photos
    img.onload = () => {
      if (cancelled) return;
      const w = img.naturalWidth || FALLBACK.w;
      const h = img.naturalHeight || FALLBACK.h;
      const fit = Math.min((window.innerWidth * 0.9) / w, (window.innerHeight * 0.7) / h, 1);
      setImage(img);
      setNatural({ w, h });
      setFitScale(fit);
    };
    img.onerror = () => {
      if (cancelled) return;
      setImage(null);
      setFailed(true);
    };
    img.src = photoUrl;
    return () => {
      cancelled = true;
    };
  }, [enabled, photoUrl, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { image, natural, fitScale, failed, retry };
}
