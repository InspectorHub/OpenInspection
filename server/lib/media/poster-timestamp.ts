/**
 * Plan 7 — pure poster-frame timestamp math for the video poster picker.
 *
 * The poster picker shows a filmstrip of N evenly-spaced Stream thumbnail URLs
 * (`.../thumbnails/thumbnail.jpg?time=<sec>s`). Tapping a frame stores the
 * chosen position as a 0..1 fraction of duration (`thumbnailTimestampPct`),
 * which is what Cloudflare Stream's `video(id).update` accepts. There is NO
 * client-side frame extraction — Stream renders the chosen frame server-side.
 *
 * All functions are pure (no DOM, no Stream calls) and defensive against
 * Stream's "unknown duration" sentinel (`-1`, see worker-configuration.d.ts)
 * and a zero/negative duration (never divide by zero, never emit pct >= 1).
 */

export interface PosterFrame {
    /** 0-based filmstrip position. */
    index: number;
    /** Absolute timestamp in seconds, used for the Stream thumbnail `?time=Ns`. */
    sec: number;
    /** Fraction of duration in [0, 1) — stored as `thumbnailTimestampPct`. */
    pct: number;
}

/**
 * N evenly-spaced poster candidates across the clip. Frames span `[0, duration)`
 * (exclusive of the very end so the last frame is never a black tail/EOF frame).
 *
 * Degenerate inputs collapse to a single frame at pct 0:
 *   - duration <= 0 (includes Stream's `-1` "unknown duration")
 *   - count <= 1
 */
export function framesForDuration(durationSec: number, count: number): PosterFrame[] {
    if (!(durationSec > 0) || count <= 1) {
        return [{ index: 0, sec: 0, pct: 0 }];
    }
    const n = Math.floor(count);
    const frames: PosterFrame[] = [];
    for (let i = 0; i < n; i++) {
        const pct = i / n; // i/n keeps the last frame strictly < 1
        frames.push({ index: i, sec: pct * durationSec, pct });
    }
    return frames;
}

/** Convert an absolute second to a 0..1 fraction, clamped. Returns 0 for a non-positive duration. */
export function pctFromSec(sec: number, durationSec: number): number {
    if (!(durationSec > 0)) return 0;
    return clamp01(sec / durationSec);
}

/** Inverse of {@link pctFromSec}: a 0..1 fraction back to absolute seconds. */
export function secFromPct(pct: number, durationSec: number): number {
    if (!(durationSec > 0)) return 0;
    return clamp01(pct) * durationSec;
}

function clamp01(v: number): number {
    if (!(v > 0)) return 0; // also maps NaN → 0
    if (v > 1) return 1;
    return v;
}
