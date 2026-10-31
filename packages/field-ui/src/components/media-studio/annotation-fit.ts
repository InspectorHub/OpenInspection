/**
 * Bringing an over-limit annotated image under the server's photo ceiling by exporting it smaller.
 *
 * The annotation endpoint stores the bytes as a PNG without converting them, so a lossy re-encoding is not an option:
 * the only lever is resolution. This is the decision logic, kept pure; the canvas export stays in `PhotoAnnotator`.
 */

/** The shortest edge, in pixels, an annotated export may be shrunk to. */
export const ANNOTATION_MIN_EDGE = 640;
/** How many smaller exports are tried after the first one. */
export const ANNOTATION_MAX_STEPS = 4;

/**
 * The export ratio (relative to the natural size) to try next, or null to stop. PNG size follows area, so the step is
 * the square root of how far over the limit the last export was, with a safety margin; one step shrinks by at least a
 * tenth and at most a half. One ratio scales both edges, so the aspect ratio is kept. The ratio never goes below the one
 * that puts the shorter edge at `ANNOTATION_MIN_EDGE`: it lands there once and then gives up.
 */
export function nextAnnotationRatio(args: {
    /** The ratio of the export that was just made (1 = natural size). */
    ratio: number;
    /** Its size in bytes. */
    bytes: number;
    /** Natural width and height in pixels. */
    width: number;
    height: number;
    limit: number;
    /** How many smaller exports were already tried (0 after the first export). */
    step: number;
}): number | null {
    const { ratio, bytes, width, height, limit, step } = args;
    if (bytes <= limit || step >= ANNOTATION_MAX_STEPS) return null;
    const floor = ANNOTATION_MIN_EDGE / Math.min(width, height);
    if (ratio <= floor) return null;
    const factor = Math.min(0.9, Math.max(0.5, Math.sqrt(limit / bytes) * 0.9));
    return Math.max(ratio * factor, floor);
}

/**
 * Export the annotated image at natural size and, while it is over `limit`, again at the ratios `nextAnnotationRatio`
 * asks for. `render(ratio)` is the canvas export (null when it fails). Resolves to the smallest export made, which is
 * still over the limit when the bounded attempts were not enough: the caller then refuses it. Null only when even the
 * first export failed; a failed smaller render keeps the last export that worked.
 */
export async function exportFittingAnnotation(
    render: (ratio: number) => Promise<Blob | null>,
    size: { width: number; height: number; limit: number },
): Promise<Blob | null> {
    let ratio = 1;
    let blob = await render(ratio);
    for (let step = 0; blob; step += 1) {
        const next = nextAnnotationRatio({ ratio, bytes: blob.size, step, ...size });
        if (next === null) break;
        const smaller = await render(next);
        if (!smaller) break;
        ratio = next;
        blob = smaller;
    }
    return blob;
}
