/**
 * Putting a signature image inside a box somebody measured on an official form.
 *
 * ── Three separate ways a signature goes wrong, all of them quiet ────────────
 * A format this renderer cannot embed passes a data-URI check and is stored,
 * because the HTML surfaces that draw the same signature accept it happily; the
 * failure arrives later and somewhere else. A box and a mark almost never share
 * proportions, and `drawImage` given both a width and a height honours both, so
 * the mark comes out stretched — a document that prints, looks complete, and
 * carries a signature nobody wrote. And an image with too few pixels for the
 * space is simply blurred onto the page with nothing said. None of the three
 * raises anything by itself, so all three are decided here.
 *
 * ── Fit, then refuse, exactly as the text does ───────────────────────────────
 * `fit.ts` fits an answer to the row, shrinks it to a floor somebody measured,
 * and refuses loudly rather than clipping. A signature gets the same treatment
 * for the same reason: scaling it down to nothing, or up into mush, is a slower
 * way of losing it, and a mark nobody can read on a statutory form is worse than
 * a form that refused to build.
 *
 * ── This module does no I/O and holds no pdf-lib types ──────────────────────
 * `renderStatutoryForm` is pure and stays pure. Everything here is arithmetic
 * over two pairs of numbers — the image's pixel dimensions, which the caller
 * already has from embedding it, and the box, which the field map declares.
 * That is also what lets Settings show an inspector the SAME verdict before
 * anything is rendered, rather than a second implementation that agrees with
 * this one until it does not.
 */

/**
 * The image formats a stored signature may be in.
 *
 * ⚠️ THIS IS A PROPERTY OF pdf-lib, NOT A PREFERENCE. It embeds PNG and JPEG.
 * There is no third format and there is no vector one, so an SVG signature is
 * not a slightly worse signature here — it is a signature that cannot be drawn
 * at all, at the moment an inspector presses send.
 *
 * ⚠️ IT IS THIS RENDERER THAT IS STRICT, AND IT DECIDES FOR ALL OF THEM. The
 * agreement copy and the report are HTML, where an SVG data URI displays fine —
 * so nothing downstream of storage would ever have objected. One stored
 * signature feeds every surface, so the narrowest surface owns the list, and the
 * upload validation imports it rather than keeping a second copy. Two copies,
 * only one of them ever revisited, is how `svg+xml` got accepted in the first
 * place.
 */
export const SUPPORTED_SIGNATURE_IMAGE_TYPES = ['png', 'jpeg'] as const;

export type SignatureImageType = typeof SUPPORTED_SIGNATURE_IMAGE_TYPES[number];

/** A stored signature, decoded, ready for whichever embed call its type needs. */
export interface SignatureImage {
    type: SignatureImageType;
    bytes: Uint8Array;
}

const SIGNATURE_DATA_URI = /^data:image\/([a-z+]+);base64,([A-Za-z0-9+/=]*)$/;

/**
 * Turn a stored `data:image/...;base64,...` signature into bytes.
 *
 * -- WHY IT REFUSES RATHER THAN RETURNING NULL -------------------------------
 * Every caller of this is about to put a mark in a preprinted box on an
 * authority's form, and on such a form a blank is not "no signature" — it is a
 * submission the authority rejects. A null would have to be turned into a
 * refusal at each call site, and the first site to forget produces a document
 * that looks finished and is not signed.
 *
 * The type list is `SUPPORTED_SIGNATURE_IMAGE_TYPES`, which is a property of
 * pdf-lib and not a preference (see above). `image/jpg` is deliberately NOT
 * accepted as an alias: the upload validation writes the same list, so a stored
 * value can only be one of these, and accepting a spelling nothing produces
 * would make this the second, looser parser of a shape that has one.
 *
 * @param ourField named in every refusal, because it is the string the person
 *   fixing the template or the profile has to search for.
 */
export function decodeSignatureDataUri(dataUri: string, ourField: string): SignatureImage {
    const parsed = SIGNATURE_DATA_URI.exec(dataUri);
    if (!parsed) {
        fail(`"${ourField}" has a stored signature that is not a base64 image data URI, so `
            + 'there is nothing to draw in its box.');
    }
    const subtype = parsed[1];
    if (!(SUPPORTED_SIGNATURE_IMAGE_TYPES as readonly string[]).includes(subtype)) {
        fail(`"${ourField}" has a stored signature in ${subtype} format, and a PDF can carry `
            + `only ${SUPPORTED_SIGNATURE_IMAGE_TYPES.join(' or ')}. Draw or upload the `
            + 'signature again under Settings > Profile.');
    }
    // `atob` is a WinterCG global — no Node Buffer on this runtime.
    const binary = atob(parsed[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    if (bytes.length === 0) {
        fail(`"${ourField}" has a stored signature of zero bytes; an empty mark renders as `
            + 'nothing at all rather than as an error.');
    }
    return { type: subtype as SignatureImageType, bytes };
}

/** Points per inch in PDF user space. Fixed by the format, not by us. */
const POINTS_PER_INCH = 72;

/**
 * How many image pixels each point of the drawn box must be given.
 *
 * ── Why a ratio and not a pixel count ───────────────────────────────────────
 * "At least 300 pixels wide" is right for exactly one box and wrong for every
 * other one. What determines whether a mark reads is how many pixels land on
 * each point of paper, so that is what is stated — the same shape as the font
 * floor in `fit.ts`, which is a size and not a character count.
 *
 * ── Why 2 ───────────────────────────────────────────────────────────────────
 * A point is 1/72 inch, so 1 px/pt IS 72 DPI — screen resolution, put on paper.
 * That is not a judgement call: at or below it a thin high-contrast line drawing
 * (which is all a signature is) visibly breaks into steps. 2 px/pt is 144 DPI,
 * the first whole multiple clear of that, with a stroke's width of margin.
 *
 * ── Why NOT 300 DPI, the print-artwork standard ─────────────────────────────
 * Because it would refuse this product's own output. `SignaturePad` draws on a
 * 400x150 canvas, and the signature boxes measured on these forms run around
 * 160x40 points, which places the pad's own mark at 3.75 px/pt — under a 300 DPI
 * (4.167 px/pt) floor. A gate that refuses the only signature most inspectors
 * will ever have is a gate that gets routed around rather than met. 2 sits above
 * screen resolution and below what we ourselves produce, so it fires only on a
 * mark that genuinely came from somewhere else: a thumbnail, a cropped-to-death
 * scan, an image lifted off a web page.
 */
export const MIN_SIGNATURE_PIXELS_PER_POINT = 2;

/** An image's own size, in pixels. What pdf-lib reports after embedding. */
export interface SignaturePixels {
    width: number;
    height: number;
}

/** The space the field map says the form left for this signature, in points. */
export interface SignatureBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Where the mark goes, and whether it is fit to go there. */
export interface PlacedSignature {
    /** Bottom-left corner, PDF user space — the origin `drawImage` takes. */
    x: number;
    y: number;
    /** Drawn size. ALWAYS in the source image's own proportions. */
    width: number;
    height: number;
    /** Source pixels per drawn point. The measurement the verdict is made on. */
    pixelsPerPoint: number;
    /** The same figure in the unit a person reads. Derived, never independent. */
    dpi: number;
    /**
     * True when this mark is below `MIN_SIGNATURE_PIXELS_PER_POINT`.
     *
     * A verdict rather than a throw, because two callers need the same
     * measurement and cannot both take an exception: the renderer refuses (see
     * `refuseUnreadableSignature`), and the Settings preview has to SHOW an
     * inspector which of their signature's sizes is too coarse, which it cannot
     * do if asking the question aborts.
     */
    tooSmall: boolean;
}

/** The prefix names the RENDER, matching every other refusal a reader gets. */
function fail(reason: string): never {
    throw new Error(`statutory render: ${reason}`);
}

/**
 * Place an image inside a box without changing its proportions.
 *
 * The single scale factor is the whole mechanism: taking the SMALLER of the two
 * ratios means whichever dimension runs out first bounds both, so the mark
 * touches the box on one axis and is centred with the slack on the other. Giving
 * `drawImage` a width and a height computed any other way is what stretches it.
 *
 * Centring is the same arithmetic on both axes even though PDF's origin is at
 * the bottom left: half the leftover on each side, which does not care which way
 * the axis points.
 */
export function placeSignature(pixels: SignaturePixels, box: SignatureBox): PlacedSignature {
    if (!(pixels.width > 0) || !(pixels.height > 0)) {
        fail(`a signature image measuring ${pixels.width}x${pixels.height} pixels has nothing to `
            + 'draw; the stored signature is empty or was not decoded');
    }
    if (!(box.width > 0) || !(box.height > 0)) {
        fail(`a signature box measuring ${box.width}x${box.height} points has no area; a mark `
            + 'drawn into it renders as nothing at all rather than as an error');
    }

    const scale = Math.min(box.width / pixels.width, box.height / pixels.height);
    const width = pixels.width * scale;
    const height = pixels.height * scale;
    // `scale` IS points per pixel on both axes, so its reciprocal is the density
    // — one number, because the aspect was preserved and the two axes agree.
    const pixelsPerPoint = 1 / scale;

    return {
        x: box.x + (box.width - width) / 2,
        y: box.y + (box.height - height) / 2,
        width,
        height,
        pixelsPerPoint,
        dpi: pixelsPerPoint * POINTS_PER_INCH,
        tooSmall: pixelsPerPoint < MIN_SIGNATURE_PIXELS_PER_POINT,
    };
}

/**
 * Stop a render that would put an unreadable mark on an authority's form.
 *
 * ── Why this refuses instead of drawing it anyway ───────────────────────────
 * A blurred signature is not a degraded signature; on a submitted statutory form
 * it is a signature somebody can say is not theirs. And the failure is silent in
 * the direction that matters — the document builds, prints, and looks finished,
 * so nobody finds out until it is in front of the authority.
 *
 * ── Why the message carries both numbers and a destination ──────────────────
 * It is read by an inspector, not by a log. What their mark measures, what the
 * form needs, and the screen that fixes it are the three things that let them
 * finish; "signature too small" is a wall. DPI rather than pixels-per-point
 * because that is the number printed beside every scanner setting they own.
 */
export function refuseUnreadableSignature(placed: PlacedSignature, ourField: string): void {
    if (!placed.tooSmall) return;
    const needed = MIN_SIGNATURE_PIXELS_PER_POINT * POINTS_PER_INCH;
    fail(`"${ourField}" would be drawn at ${Math.round(placed.dpi)} DPI, and this form needs at `
        + `least ${needed} DPI. Draw the signature again, or upload a larger scan of it, under `
        + 'Settings > Profile.');
}
