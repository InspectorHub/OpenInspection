/**
 * Putting a resolved signature on the page — the pdf-lib half of
 * `signature-image.ts`.
 *
 * -- WHY THE ARITHMETIC IS NOT HERE ------------------------------------------
 * `signature-image.ts` holds no pdf-lib types on purpose, so that Settings can
 * show an inspector the SAME verdict about their mark before anything is
 * rendered. This file is the other side of that line: it embeds, asks
 * `placeSignature` where the mark goes, lets `refuseUnreadableSignature` decide
 * whether it may go there at all, and draws. It decides nothing itself.
 *
 * -- WHY IT IS NOT INSIDE render.ts ------------------------------------------
 * `render.ts` is at the 400-line ceiling and this is a cohesive unit. Splitting
 * is the documented preference over raising a baseline.
 */
import type { PDFDocument, PDFPage } from 'pdf-lib';
import type { FieldMapping } from './field-map';
import { placeSignature, refuseUnreadableSignature, type SignatureImage } from './signature-image';

export type { SignatureImage };

function fail(reason: string): never {
    throw new Error(`statutory render: ${reason}`);
}

/**
 * The box a mapping leaves for a mark, in PDF user space.
 *
 * A `signature` mapping states one outright. An `overlay` states a text anchor
 * plus the room somebody measured around it, and a signature bound to such a
 * field takes exactly that room: `x`/`y` is the baseline the value would have
 * been written on — the printed rule itself — so a mark whose bottom edge sits
 * there sits ON the line, which is where a signature belongs and is also where
 * the text it replaces would have sat.
 *
 * An overlay with no measured box is REFUSED rather than guessed at. Every
 * other refusal in this subsystem exists because a wrong mark on an authority's
 * form still prints and still looks finished; a signature drawn into invented
 * dimensions is that failure with somebody's name on it.
 */
function boxFor(mapping: FieldMapping): {
    page: number; x: number; y: number; width: number; height: number;
} {
    if (mapping.kind === 'signature') {
        return {
            page: mapping.page, x: mapping.x, y: mapping.y,
            width: mapping.width, height: mapping.height,
        };
    }
    if (mapping.kind !== 'overlay') {
        fail(`"${mapping.ourField}" is bound to a signature and mapped as a ${mapping.kind}, `
            + 'which has no box to draw a mark in.');
    }
    if (mapping.maxWidth === undefined || mapping.maxHeight === undefined) {
        fail(`"${mapping.ourField}" is bound to a signature and its overlay declares no measured `
            + 'box (maxWidth and maxHeight). A mark drawn into unmeasured space lands somewhere '
            + 'nobody checked; add the two measurements to the field map, or map it as a '
            + 'signature.');
    }
    return {
        page: mapping.page, x: mapping.x, y: mapping.y,
        width: mapping.maxWidth, height: mapping.maxHeight,
    };
}

/**
 * Embed one stored signature and draw it inside the box its mapping declares.
 *
 * @param image the decoded mark, or `undefined` when nothing resolved it —
 *   which is a refusal, not a skip. A signature box left empty prints, looks
 *   finished, and is an unsigned statutory submission.
 */
export async function drawSignature(
    doc: PDFDocument,
    pages: readonly PDFPage[],
    mapping: FieldMapping,
    image: SignatureImage | undefined,
): Promise<void> {
    if (!image) {
        fail(`"${mapping.ourField}" is a signature this form requires and nothing supplied one. `
            + 'Save a signature under Settings > Profile, or ask the inspector on this '
            + 'inspection to.');
    }
    const box = boxFor(mapping);
    const page = pages[box.page];
    if (!page) fail(`"${mapping.ourField}" names page ${box.page}, which this form does not have.`);

    const embedded = image.type === 'png'
        ? await doc.embedPng(image.bytes)
        : await doc.embedJpg(image.bytes);

    const placed = placeSignature({ width: embedded.width, height: embedded.height }, box);
    // Measured before it is drawn, and refused rather than blurred: a mark
    // nobody can read on a statutory form is a mark somebody can say is not
    // theirs.
    refuseUnreadableSignature(placed, mapping.ourField);

    page.drawImage(embedded, {
        x: placed.x,
        y: placed.y,
        width: placed.width,
        height: placed.height,
    });
}
