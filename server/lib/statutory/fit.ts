/**
 * Does the answer fit the space the form left for it — and what to do when it
 * does not.
 *
 * ── The failure this exists to stop ─────────────────────────────────────────
 * A statutory form gives every answer a fixed amount of room, and there are two
 * ways to write more than fits. Drawn text wraps DOWNWARD with no height bound,
 * so a long answer runs over the row beneath it. A form field CLIPS whatever its
 * widget cannot show. Neither raises anything; both produce a document that
 * looks filled, prints, and passes every assertion about its own values. They
 * are one failure wearing two hats, so they are measured in one place.
 *
 * ── This is the ordinary case, not the edge case ────────────────────────────
 * Measured on the two forms with no fillable anything: 47 of 72 overlay rows on
 * one and 47 of 48 on the other have room for a single line.
 *
 * ── Fit, shrink to a declared floor, then refuse ────────────────────────────
 * Truncating is worse than either failure it replaces — a clipped statutory form
 * looks exactly like a filled one. Shrinking with no floor is only a slower way
 * of losing the answer: it produces type nobody can read. So the floor comes
 * from the map, where somebody measured the row, and the refusal is loud.
 *
 * ── The refusal carries both numbers and a destination ──────────────────────
 * It is read by a person deciding what to move off the page, not by a log. How
 * much fits, how much they wrote, and where the rest goes are the three things
 * that let them finish; "too long" is just a wall. The forms themselves supply
 * the destination — the comments box on one of them prints "(use additional
 * pages if needed)".
 */
import type { PDFFont, PDFTextField } from 'pdf-lib';
import type { OverlayMapping } from './field-map';

/** How far the text steps down while looking for a size that fits. */
const SHRINK_STEP = 0.5;

/**
 * The size an auto-sizing form field is measured at.
 *
 * Such a field declares `0 Tf` and shrinks its own text to fit its box with no
 * floor of its own. Below about this size the answer stops being readable on a
 * printed form, so this is where the measurement stops pretending it fits.
 */
const AUTO_SIZE_FLOOR = 6;

/** Padding a widget leaves between its rectangle and the text inside it. */
const WIDGET_PADDING = 2;

/**
 * The step pdf-lib's own layout puts between baselines.
 *
 * ⚠️ NOT `font.heightAtSize(size)`, WHICH THIS USED AND WHICH IS 20% TOO SMALL.
 * `pdf-lib/cjs/api/text/layout.js` computes, verbatim:
 *
 *     var height = font.heightAtSize(fontSize);
 *     var lineHeight = height + height * 0.2;
 *
 * and then, for EVERY line including the first, `y -= lineHeight` from the top
 * of the box. So `n` lines occupy `n * lineHeight`, not `n * heightAtSize`.
 *
 * What the old number bought: on the Texas form's `Text4` (rect 401.9 x 34.08,
 * inner height 32.08 after padding) it computed `3 * 9.25 = 27.75 <= 32.08` and
 * PASSED. The real layout puts the three baselines at 21.984 / 10.884 / -0.216,
 * and the third is below the clip. Ten fields on one real inspection came out
 * with their last line sliced in half.
 *
 * ⚠️ AND NOTHING ELSE COULD SEE IT. The field reads back whole, so every
 * assertion about field contents passed; only a rasteriser shows the cut. A
 * guard that passes text the document then cuts is worse than no guard, because
 * it is the reason nobody looked.
 *
 * The 1.2 is pinned by `appearance-line-height.spec.ts`, which renders a real
 * multiline field and measures the step against this formula. Expressed as a
 * factor on `heightAtSize` rather than on the font size, because it is a factor
 * on the FONT's height -- a form set in something else measures itself.
 */
const APPEARANCE_LINE_GAP = 1.2;

/** The vertical space `lines` of `size` actually occupy inside a widget. */
function occupiedHeight(lines: number, size: number, ruler: PDFFont): number {
    return lines * ruler.heightAtSize(size) * APPEARANCE_LINE_GAP;
}

/** What a value ended up being drawn at, once the room for it was measured. */
export interface FittedText {
    /** The size actually drawn at — at or above the floor the map declared. */
    size: number;
    /**
     * The spacing for wrapped lines, or null when nothing was measured. Null
     * leaves pdf-lib's own default in place, which is what an overlay with no
     * declared height has always rendered with.
     */
    lineHeight: number | null;
}

/**
 * The prefix names the RENDER, not this module.
 *
 * Every one of these refusals reaches somebody as "the form would not come out
 * right", and a message that named a helper would tell them where the code
 * lives instead of what happened to their document.
 */
function fail(reason: string): never {
    throw new Error(`statutory render: ${reason}`);
}

/**
 * What a refusal calls this overlay.
 *
 * One field can now have three overlays, one per printed blank. A message that
 * named only the field would leave the reader to work out which of the three
 * boxes on the page would not hold its answer.
 */
function overlayLabel(m: OverlayMapping): string {
    return m.part === undefined ? m.ourField : `${m.ourField} (${m.part})`;
}

/**
 * Fit an overlay value to the room somebody measured, or refuse it.
 *
 * Steps down from the declared size to the declared floor and takes the first
 * size whose wrapped text stays inside the row. With no floor declared there is
 * no shrinking: a floor nobody measured is not a floor, and inventing one would
 * put unreadable type on a statutory form on our own authority.
 */
export function fitOverlay(value: string, mapping: OverlayMapping, font: PDFFont): FittedText {
    const { maxHeight, maxWidth } = mapping;
    // Nobody measured this row, so there is nothing to fit against and the value
    // renders exactly as it did before these fields existed.
    if (maxHeight === undefined || maxWidth === undefined) {
        return { size: mapping.size, lineHeight: null };
    }

    const floor = mapping.minSize ?? mapping.size;
    // Bounded to ~64 trials however far apart the two sizes are.
    const step = Math.max(SHRINK_STEP, (mapping.size - floor) / 64);
    for (let size = mapping.size; size > floor; size -= step) {
        const fitted = fitAtSize(value, font, size, maxWidth, maxHeight);
        if (fitted !== null) return fitted;
    }
    const atFloor = fitAtSize(value, font, floor, maxWidth, maxHeight);
    if (atFloor !== null) return atFloor;

    fail(`"${overlayLabel(mapping)}" fits about ${charactersThatFit(value, font, floor, maxWidth, maxHeight)} `
        + `characters in this row and received ${value.length}. Put the remainder on an additional `
        + 'page or as an attachment.');
}

/**
 * The mirror of the overlay overflow, and the same failure underneath.
 *
 * `setText` hands the value to the widget, which shows what its box can hold and
 * drops the rest. Nothing is raised and the document that comes out looks
 * filled; the only difference from an overflow is which end of the answer goes
 * missing.
 *
 * ⚠️ WHAT IS MEASURED AND WHAT IS ASSUMED. The widget rectangle and any
 * `/MaxLen` are read off the form itself. The FONT is not — the form names its
 * own, and this measures with the caller's, because the alternative is embedding
 * a font of ours into a document we would otherwise leave untouched. A form set
 * in something appreciably wider is therefore measured a little optimistically.
 */
export function refuseIfTheWidgetWouldClip(
    field: PDFTextField, ourField: string, value: string, ruler: PDFFont,
): void {
    if (value === '') return;

    const maxLength = field.getMaxLength();
    if (maxLength !== undefined && value.length > maxLength) {
        fail(`"${ourField}" fits about ${maxLength} characters in this field and received `
            + `${value.length}. Put the remainder on an additional page or as an attachment.`);
    }

    const box = smallestWidgetBox(field);
    if (box === null) return;
    // A field that sizes itself declares `0 Tf` and shrinks its own text with no
    // floor. That is not a licence to shrink without limit, so it is judged at a
    // stated floor for the same reason an overlay carries one.
    const size = declaredFontSize(field.acroField.getDefaultAppearance()) || AUTO_SIZE_FLOOR;
    const lines = field.isMultiline()
        ? countWrappedLines(value, ruler, size, box.width)
        // A single-line widget cannot show a break at all, so a value carrying
        // one does not fit however narrow it is -- and asking for its width
        // would throw rather than say so.
        : (writtenLines(value).length === 1
            && ruler.widthOfTextAtSize(value, size) <= box.width ? 1 : null);
    if (lines !== null && occupiedHeight(lines, size, ruler) <= box.height) return;

    fail(`"${ourField}" fits about ${charactersThatFit(value, ruler, size, box.width, box.height)} `
        + `characters in this field and received ${value.length}. Put the remainder on an `
        + 'additional page or as an attachment.');
}

/**
 * The lines a value is written as, before any wrapping.
 *
 * pdf-lib's WinAnsi encoder REFUSES a break character -- `widthOfTextAtSize`
 * on a value containing one throws `WinAnsi cannot encode "
"` rather than
 * returning a width. So every measurement here splits first, and nothing is
 * ever handed a raw multi-line string.
 *
 * Measured: a section's Comments box composed from three canned entries and the
 * inspector's notes is four lines, and it crashed the whole render with a 500 --
 * not the field, the DOCUMENT. `countWrappedLines` had always split; the
 * single-line branch and the refusal's own character estimate had not.
 */
function writtenLines(value: string): string[] {
    return value.split(/[\n\f\r]/);
}

/** One trial: does the wrapped value stay inside the space at this size? */
function fitAtSize(
    value: string, font: PDFFont, size: number, maxWidth: number, maxHeight: number,
): FittedText | null {
    const lineHeight = font.heightAtSize(size);
    const lines = countWrappedLines(value, font, size, maxWidth);
    if (lines === null || lines * lineHeight > maxHeight) return null;
    return { size, lineHeight };
}

/**
 * How many lines this value wraps onto, or null when it will not wrap at all.
 *
 * It mirrors pdf-lib's own breaking rather than an ideal one: pdf-lib breaks on
 * spaces and never inside a word, so one long unbroken run does not become
 * several lines — it becomes a single line running off the side of the column.
 * Counting that any other way would produce a number that agrees with itself and
 * disagrees with the page. It returns null instead: this value does not fit
 * here, and only a smaller size can change that.
 */
function countWrappedLines(
    text: string, font: PDFFont, size: number, maxWidth: number,
): number | null {
    let lines = 0;
    for (const paragraph of text.split(/[\n\f\r]/)) {
        // Each word carries its own trailing space, exactly as pdf-lib measures it.
        const words = (paragraph.match(/[^ ]* ?/g) ?? []).filter((w) => w !== '');
        lines += 1;
        let lineWidth = 0;
        for (const word of words) {
            const width = font.widthOfTextAtSize(word, size);
            if (width > maxWidth) return null;
            if (lineWidth > 0 && lineWidth + width > maxWidth) {
                lines += 1;
                lineWidth = 0;
            }
            lineWidth += width;
        }
    }
    return lines;
}

/**
 * Roughly how many characters of THIS value the space holds.
 *
 * Measured against the value itself rather than an average character on purpose:
 * the number is read by somebody deciding how much to move onto an additional
 * page, and a figure derived from somebody else's text sends them back with the
 * wrong amount.
 */
function charactersThatFit(
    value: string, font: PDFFont, size: number, maxWidth: number, maxHeight: number,
): number {
    // Widths are taken per line for the reason `writtenLines` gives; the
    // per-character figure is the value's own, which is the whole point of
    // measuring this value rather than an average one.
    const lineList = writtenLines(value);
    const totalWidth = lineList.reduce((sum, l) => sum + font.widthOfTextAtSize(l, size), 0);
    const characters = lineList.reduce((sum, l) => sum + l.length, 0);
    const perCharacter = characters > 0 ? totalWidth / characters : 0;
    if (!(perCharacter > 0)) return 0;
    // The same measurement the refusal above uses. When these two disagreed,
    // the message told a reader their text fit and then refused it -- measured:
    // "fits about 276 characters ... and received 271".
    let lines = 0;
    while (occupiedHeight(lines + 1, size, font) <= maxHeight) lines += 1;
    const byWidth = Math.max(0, lines * Math.floor(maxWidth / perCharacter));

    // ⚠️ A HARD BREAK IS NOT WIDTH. `byWidth` assumes every line is filled edge
    // to edge, which a value carrying breaks never does: each break ends its
    // line wherever it falls. So a four-line value can be refused while this
    // figure still reads larger than what was refused -- measured on the TREC
    // roof-covering box, "fits about 176 characters ... and received 144",
    // which is the same self-contradiction this function was written to end.
    //
    // The honest ceiling for such a value is what its own lines could hold at
    // the height available, and never more than it actually carries: a capacity
    // above the refused length is not an estimate, it is a wrong sentence.
    if (lineList.length <= 1) return byWidth;
    const usableLines = Math.min(lines, lineList.length);
    const byLine = lineList
        .slice(0, usableLines)
        .reduce((sum, l) => sum + l.length, 0);
    return Math.min(byWidth, byLine, Math.max(0, characters - 1));
}

/**
 * The usable interior of the TIGHTEST box this field is drawn in.
 *
 * The tightest rather than the roomiest: a field repeated across pages is
 * printed in every one of them, so a value that overruns the small copy produces
 * a wrong page whatever the others can hold.
 */
function smallestWidgetBox(field: PDFTextField): { width: number; height: number } | null {
    let smallest: { width: number; height: number } | null = null;
    for (const widget of field.acroField.getWidgets()) {
        const rect = widget.getRectangle();
        const width = rect.width - 2 * WIDGET_PADDING;
        const height = rect.height - 2 * WIDGET_PADDING;
        if (!(width > 0) || !(height > 0)) continue;
        if (smallest === null || width * height < smallest.width * smallest.height) {
            smallest = { width, height };
        }
    }
    return smallest;
}

/**
 * The size out of a field's default appearance string (`/Helv 9 Tf`).
 *
 * Zero when it declares none, which is also exactly what a field that sizes
 * itself declares — the two are the same case and are treated as one.
 */
function declaredFontSize(defaultAppearance: string | undefined): number {
    if (defaultAppearance === undefined) return 0;
    let size = 0;
    for (const match of defaultAppearance.matchAll(/(\d+(?:\.\d+)?)\s+Tf\b/g)) {
        size = Number(match[1]);
    }
    return Number.isFinite(size) ? size : 0;
}
