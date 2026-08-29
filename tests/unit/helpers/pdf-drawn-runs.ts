/**
 * What text was drawn where, read back off the page.
 *
 * ── Why "it rendered" is not an assertion ───────────────────────────────────
 * The failure this repository's statutory subsystem is built around draws
 * perfectly well. A date written as one string onto a form that prints three
 * separate blanks produces a page that renders, prints and files — with the year
 * sitting across the wrong blank. Every assertion of the form "the page changed"
 * holds for it. Only the COORDINATE tells the two apart.
 *
 * ── What is being parsed ────────────────────────────────────────────────────
 * pdf-lib's `drawText` emits one text object per call:
 *
 *     BT
 *     /Helvetica-7098480789 9 Tf
 *     8.325 TL
 *     1 0 0 1 472.2 439.84 Tm
 *     <3033> Tj
 *     T*
 *     ET
 *
 * `Tm` carries the origin, `Tf` the size, and `<hex> Tj` the bytes shown. A
 * standard-font Helvetica is WinAnsi-encoded, so those bytes are the characters.
 *
 * ⚠️ THIS READS pdf-lib's OWN OUTPUT, not PDF in general. It is a measuring
 * instrument for these tests, exactly like `pageContentDigests` beside it, and
 * it is not a capability the product has. A page produced by anything else — an
 * agency's own file, a different writer — is out of its scope by construction.
 *
 * ⚠️ AN EMPTY RESULT READS AS FAILURE, NOT AS PASS. A parser that matched
 * nothing would return `[]`, and `[]` satisfies every assertion of the form
 * "none of the runs is wrong". So the tests here assert the runs they EXPECT,
 * by value, rather than asserting the absence of bad ones.
 */
import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

export interface DrawnRun {
    /** The characters shown by one `Tj`. */
    text: string;
    /** The text-matrix origin: pdf-lib's `x`/`y`, in PDF user space. */
    x: number;
    y: number;
    /** The size from the `Tf` that governs this block. */
    size: number;
}

const BLOCK = /BT\b([\s\S]*?)\bET\b/g;
const SIZE = /\/\S+\s+(-?[\d.]+)\s+Tf/;
const ORIGIN = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/;
const SHOWN = /<([0-9A-Fa-f]+)>\s*Tj/g;

/** The decoded content streams of one page, as a byte-per-character string. */
async function contentOf(bytes: Uint8Array, page: number): Promise<string> {
    const doc = await PDFDocument.load(bytes);
    const pg = doc.getPages()[page];
    const contents = pg.node.get(PDFName.of('Contents'));
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    let out = '';
    for (const ref of refs) {
        const stream = pg.doc.context.lookup(ref);
        if (!(stream instanceof PDFRawStream)) continue;
        // Built character by character rather than through TextDecoder: the
        // stream is binary, and every decoder that has a name also has an
        // opinion about bytes above 0x7F.
        for (const byte of decodePDFRawStream(stream).decode()) {
            out += String.fromCharCode(byte);
        }
    }
    return out;
}

/** Every run of text drawn on one page, in the order it was written. */
export async function drawnRuns(bytes: Uint8Array, page: number): Promise<DrawnRun[]> {
    const stream = await contentOf(bytes, page);
    const runs: DrawnRun[] = [];
    for (const [, body] of stream.matchAll(BLOCK)) {
        const origin = ORIGIN.exec(body);
        const size = SIZE.exec(body);
        // A block with no origin or no size draws nothing this can describe —
        // reported as absent rather than guessed at.
        if (origin === null || size === null) continue;
        for (const [, hex] of body.matchAll(SHOWN)) {
            runs.push({
                text: (hex.match(/../g) ?? [])
                    .map((pair) => String.fromCharCode(parseInt(pair, 16)))
                    .join(''),
                x: Number(origin[1]),
                y: Number(origin[2]),
                size: Number(size[1]),
            });
        }
    }
    return runs;
}
