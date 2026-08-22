/**
 * Choosing a report appearance for a workspace arriving from another product —
 * with no model involved at any point, and none needed.
 *
 * WHY THIS IS ARITHMETIC AND NOT INFERENCE. The report style this product
 * offers is a CLOSED SET: three built-in profiles and one primary colour. There
 * is no free-form answer for a model to produce, so the whole question reduces
 * to "which of three", and "which of three" from a colour is a comparison. A
 * model asked the same question would cost tokens, disclose the workspace's
 * branding to a third party, and return one of the three answers arithmetic
 * already gives — or a fourth that does not exist.
 *
 * So this file sends nothing anywhere. It has no provider, no prompt, no
 * metering and no capability entry, and it must not acquire any: the moment the
 * style half needs credentials, it inherits every constraint the inference half
 * carries, for a question that was never hard.
 *
 * WHAT IT REFUSES TO ANSWER. `dominantBrandColour` returns `null` far more
 * often than a colour-picker would. Grey is not a brand, a logo's white
 * background is not a brand, and two stray anti-aliased pixels are not a brand.
 * There is deliberately no "best guess" return shape — no confidence score, no
 * "probably this" — because a caller handed a weak answer in the same shape as
 * a strong one will use it, and a workspace's report would come out the colour
 * of its logo's drop shadow.
 */
import { BUILTIN_PROFILES, DEFAULT_PROFILE_ID } from './profiles';

/** Hue, saturation and value in [0,360) and [0,1]. */
interface Hsv { h: number; s: number; v: number }

function toHsv(r: number, g: number, b: number): Hsv {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;
    if (delta !== 0) {
        if (max === r) h = 60 * (((g - b) / delta) % 6);
        else if (max === g) h = 60 * ((b - r) / delta + 2);
        else h = 60 * ((r - g) / delta + 4);
    }
    return { h: (h + 360) % 360, s: max === 0 ? 0 : delta / max, v: max / 255 };
}

function parseHex(colour: string): Hsv | null {
    const match = /^#?([0-9a-fA-F]{6})$/.exec(colour.trim());
    if (!match) return null;
    const n = parseInt(match[1]!, 16);
    return toHsv((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
}

/**
 * A colour saturated and bright enough to be somebody's brand rather than ink,
 * paper or a shadow.
 *
 * Both thresholds are judgement calls and both err towards refusing. A logo
 * that fails them costs the operator one colour picker; a near-grey that
 * passes them puts a muddy tint through every heading of every report.
 */
function isBrandLike({ s, v }: Hsv): boolean {
    return s >= 0.25 && v >= 0.15 && v <= 0.96;
}

/**
 * Which built-in profile a brand colour belongs with.
 *
 * Keyed on HUE, not on distance to some token in each profile's palette. The
 * profiles differ by temperament — `Meridian` is the cool, squared-off one and
 * `Terra` the warm, serifed one — and hue is the property that says which of
 * those a colour reads as. A nearest-neighbour over RGB would answer with
 * whichever palette happened to contain a similar shade of grey, which is not a
 * fact about the brand.
 *
 * Anything outside the two named arcs, and anything too washed out to have a
 * hue worth reading, gets the neutral profile. That is a real answer and the
 * commonest correct one, not a fallback for having failed.
 */
export function nearestProfile(colour: string): string {
    const hsv = parseHex(colour);
    if (!hsv || !isBrandLike(hsv)) return DEFAULT_PROFILE_ID;
    // Warm: orange through amber and brown, which is where an earthy mark sits.
    if (hsv.h >= 10 && hsv.h < 65 && 'terra' in BUILTIN_PROFILES) return 'terra';
    // Cool: cyan through indigo, which is where a corporate blue sits.
    if (hsv.h >= 175 && hsv.h < 280 && 'meridian' in BUILTIN_PROFILES) return 'meridian';
    return DEFAULT_PROFILE_ID;
}

/** Hue buckets, wide enough that anti-aliasing along one edge stays together. */
const HUE_BUCKET = 30;
/** Below this many brand-like pixels, there is no answer worth giving. */
const MIN_PIXELS = 8;
/** …and they must be this share of the brand-like pixels, so a mark that is
 *  half one colour and half another does not resolve to whichever won by one. */
const MIN_SHARE = 0.35;

/**
 * The brand colour of a decoded image, or `null`.
 *
 * The argument is RGBA bytes — the shape an image arrives in once something
 * else has decoded it. Decoding is deliberately NOT done here: it is the one
 * part of this that needs a codec, and keeping it out means this module is pure
 * arithmetic that runs anywhere and can be tested with four numbers.
 *
 * Neutral pixels are not counted at all, rather than counted and outvoted. A
 * logo is mostly its background; counting the background would make almost
 * every answer white, which is then discarded, and the feature would look like
 * it simply never works.
 */
export function dominantBrandColour(rgba: Uint8ClampedArray | Uint8Array): string | null {
    const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
    let counted = 0;
    for (let i = 0; i + 3 < rgba.length; i += 4) {
        const a = rgba[i + 3]!;
        if (a < 128) continue;
        const r = rgba[i]!;
        const g = rgba[i + 1]!;
        const b = rgba[i + 2]!;
        const hsv = toHsv(r, g, b);
        if (!isBrandLike(hsv)) continue;
        counted++;
        const key = Math.floor(hsv.h / HUE_BUCKET);
        const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
        bucket.count++;
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
        buckets.set(key, bucket);
    }

    if (counted < MIN_PIXELS) return null;
    let winner: { count: number; r: number; g: number; b: number } | null = null;
    for (const bucket of buckets.values()) {
        if (!winner || bucket.count > winner.count) winner = bucket;
    }
    if (!winner || winner.count < MIN_PIXELS || winner.count / counted < MIN_SHARE) return null;

    const hex = (n: number): string => Math.round(n / winner!.count).toString(16).padStart(2, '0');
    return `#${hex(winner.r)}${hex(winner.g)}${hex(winner.b)}`;
}
